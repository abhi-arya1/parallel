"""
Code execution endpoints.
"""

import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import modal.exception

from ..models.schemas import (
    ExecuteRequest,
    ExecuteResponse,
    CellOutput,
    BashExecuteRequest,
    BashExecuteResponse,
)
from ..services.convex import (
    get_workspace_gpu,
    get_workspace_cells,
    save_cell_output,
    clear_cell_outputs,
)
from ..services.modal_sandbox import ensure_sandbox, create_sandbox, terminate_kernel
from ..services.execution import execute_on_kernel, stream_execute_on_kernel, execute_bash
from ..utils.logging import logger

router = APIRouter()


@router.post("/execute")
async def execute_cells(request: ExecuteRequest) -> ExecuteResponse:
    """
    Execute code cells for a workspace.

    If cell_id is provided, executes only that cell.
    Otherwise, executes all code cells in the workspace in order.
    """
    try:
        workspace_id = request.workspace_id
        gpu = get_workspace_gpu(workspace_id)

        # Ensure sandbox is running
        sandbox_id = await ensure_sandbox(workspace_id, gpu)

        # Load cells from Convex
        cells = get_workspace_cells(workspace_id)

        if not cells:
            return ExecuteResponse(success=True, outputs=[], error="No cells found")

        # Filter to requested cell(s)
        if request.cell_id:
            cells = [
                c
                for c in cells
                if c.id == request.cell_id or c.yjs_cell_id == request.cell_id
            ]
            if not cells:
                raise HTTPException(status_code=404, detail="Cell not found")

        # Filter to Python code cells only
        code_cells = [
            c
            for c in cells
            if c.type == "code" and (c.language is None or c.language == "python")
        ]

        if not code_cells:
            return ExecuteResponse(
                success=True, outputs=[], error="No Python code cells to execute"
            )

        all_outputs: list[CellOutput] = []

        for cell in code_cells:
            # Clear previous outputs
            clear_cell_outputs(cell.id)

            # Execute on kernel with retry on sandbox expiry
            try:
                result = await execute_on_kernel(
                    sandbox_id, cell.id, cell.yjs_cell_id, cell.content
                )
            except modal.exception.NotFoundError as e:
                logger.warning(f"Sandbox expired, recreating: {e}")
                await terminate_kernel(workspace_id)
                sandbox_id = await create_sandbox(workspace_id, gpu)
                result = await execute_on_kernel(
                    sandbox_id, cell.id, cell.yjs_cell_id, cell.content
                )
            except Exception as e:
                logger.error(f"Execution failed, recreating sandbox for {workspace_id}: {e}")
                await terminate_kernel(workspace_id)
                sandbox_id = await create_sandbox(workspace_id, gpu)
                result = await execute_on_kernel(
                    sandbox_id, cell.id, cell.yjs_cell_id, cell.content
                )

            # Process outputs
            if result.get("stdout"):
                output = CellOutput(
                    cell_id=cell.id,
                    yjs_cell_id=cell.yjs_cell_id,
                    type="stdout",
                    content=result["stdout"],
                )
                all_outputs.append(output)
                save_cell_output(cell.id, cell.yjs_cell_id, "stdout", result["stdout"])

            if result.get("stderr"):
                output = CellOutput(
                    cell_id=cell.id,
                    yjs_cell_id=cell.yjs_cell_id,
                    type="stderr",
                    content=result["stderr"],
                )
                all_outputs.append(output)
                save_cell_output(cell.id, cell.yjs_cell_id, "stderr", result["stderr"])

            if result.get("error"):
                output = CellOutput(
                    cell_id=cell.id,
                    yjs_cell_id=cell.yjs_cell_id,
                    type="error",
                    content=result["error"],
                )
                all_outputs.append(output)
                save_cell_output(cell.id, cell.yjs_cell_id, "error", result["error"])

            for img in result.get("images", []):
                output = CellOutput(
                    cell_id=cell.id,
                    yjs_cell_id=cell.yjs_cell_id,
                    type="image",
                    content=img,
                )
                all_outputs.append(output)
                save_cell_output(cell.id, cell.yjs_cell_id, "image", img)

            if result.get("result"):
                expr_result = result["result"]
                output_type = expr_result.get("type", "result")
                output_content = expr_result.get("content", "")
                output = CellOutput(
                    cell_id=cell.id,
                    yjs_cell_id=cell.yjs_cell_id,
                    type=output_type,
                    content=output_content,
                )
                all_outputs.append(output)
                save_cell_output(cell.id, cell.yjs_cell_id, output_type, output_content)

        return ExecuteResponse(success=True, outputs=all_outputs)

    except HTTPException:
        raise
    except Exception as e:
        return ExecuteResponse(success=False, outputs=[], error=str(e))


@router.post("/execute/{workspace_id}/{cell_id}")
async def execute_single_cell(workspace_id: str, cell_id: str) -> ExecuteResponse:
    """Execute a single cell."""
    return await execute_cells(
        ExecuteRequest(workspace_id=workspace_id, cell_id=cell_id)
    )


@router.get("/stream/{workspace_id}/{cell_id}")
async def stream_execute_cell(workspace_id: str, cell_id: str):
    """Execute a single cell with streaming output via NDJSON."""
    logger.info(f"Stream requested for workspace {workspace_id}, cell {cell_id}")
    
    async def event_generator():
        try:
            gpu = get_workspace_gpu(workspace_id)
            sandbox_id = await ensure_sandbox(workspace_id, gpu)
            
            cells = get_workspace_cells(workspace_id)
            cell = next(
                (c for c in cells if c.id == cell_id or c.yjs_cell_id == cell_id),
                None
            )
            
            if not cell:
                yield json.dumps({"type": "error", "message": "Cell not found"}) + "\n"
                yield json.dumps({"type": "done"}) + "\n"
                return
            
            if cell.type != "code":
                yield json.dumps({"type": "error", "message": "Not a code cell"}) + "\n"
                yield json.dumps({"type": "done"}) + "\n"
                return
            
            clear_cell_outputs(cell.id)
            
            retried = False
            while True:
                try:
                    async for event in stream_execute_on_kernel(
                        sandbox_id, cell.id, cell.yjs_cell_id, cell.content
                    ):
                        yield event
                    break
                except modal.exception.NotFoundError as e:
                    if retried:
                        raise
                    logger.warning(f"Sandbox expired, recreating: {e}")
                    yield json.dumps({"type": "stdout", "data": "[Kernel restarting...]\n"}) + "\n"
                    await terminate_kernel(workspace_id)
                    sandbox_id = await create_sandbox(workspace_id, gpu)
                    retried = True
                
        except Exception as e:
            logger.exception(f"Stream error: {e}")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
            yield json.dumps({"type": "done"}) + "\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/bash")
async def execute_bash_command(request: BashExecuteRequest) -> BashExecuteResponse:
    """Execute a bash command in the workspace sandbox."""
    try:
        workspace_id = request.workspace_id
        gpu = get_workspace_gpu(workspace_id)
        sandbox_id = await ensure_sandbox(workspace_id, gpu)
        
        result = await execute_bash(sandbox_id, request.command)
        
        return BashExecuteResponse(
            success=result["success"],
            stdout=result["stdout"],
            stderr=result["stderr"],
            exit_code=result["exit_code"],
        )
        
    except Exception as e:
        logger.exception(f"Bash execution error: {e}")
        return BashExecuteResponse(
            success=False,
            error=str(e),
            exit_code=-1,
        )
