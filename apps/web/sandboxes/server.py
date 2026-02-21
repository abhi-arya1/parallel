"""
Sandbox Server for Parallel

Loads workspace cells from Convex and executes Python code cells
notebook-style on Modal sandboxes.
"""

import os
from contextlib import asynccontextmanager
from typing import Optional

import modal
from convex import ConvexClient
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

# ---------------------------------------------------------------------------
# Convex Client Setup
# ---------------------------------------------------------------------------

CONVEX_URL = os.getenv("CONVEX_URL") or os.getenv("NEXT_PUBLIC_CONVEX_URL")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")

convex_client: Optional[ConvexClient] = None


def get_convex_client() -> ConvexClient:
    global convex_client
    if convex_client is None:
        if not CONVEX_URL:
            raise RuntimeError("CONVEX_URL not configured")
        convex_client = ConvexClient(CONVEX_URL)
    return convex_client


# ---------------------------------------------------------------------------
# Modal Sandbox Definition
# ---------------------------------------------------------------------------

# Define the Modal app and sandbox image
sandbox_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "numpy",
    "pandas",
    "matplotlib",
    "scikit-learn",
    "scipy",
    "seaborn",
)

app_modal = modal.App("parallel-sandbox")


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------


class Cell(BaseModel):
    id: str  # Convex _id
    yjs_cell_id: str
    type: str  # "markdown" | "code"
    content: str
    language: Optional[str] = None
    order_index: Optional[int] = None
    status: str


# GPU types supported by Modal
GPU_TYPES = [
    "T4",
    "L4",
    "A10",
    "A100",
    "A100-40GB",
    "A100-80GB",
    "L40S",
    "H100",
    "H200",
    "B200",
]


class CellOutput(BaseModel):
    cell_id: str
    yjs_cell_id: str
    type: str  # "stdout" | "stderr" | "image" | "dataframe" | "error"
    content: str


class ExecuteRequest(BaseModel):
    workspace_id: str
    cell_id: Optional[str] = None  # If None, execute all code cells in order


class ExecuteResponse(BaseModel):
    success: bool
    outputs: list[CellOutput]
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Convex Data Loading
# ---------------------------------------------------------------------------


async def load_workspace_gpu(workspace_id: str) -> str:
    """Load GPU setting for a workspace from Convex."""
    client = get_convex_client()

    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")

    gpu = client.query(
        "sync:getWorkspaceGpu",
        {"syncKey": INTERNAL_API_KEY, "workspaceId": workspace_id},
    )

    # Default to T4 if not set
    return gpu if gpu in GPU_TYPES else "T4"


async def load_workspace_cells(workspace_id: str) -> list[Cell]:
    """Load all cells for a workspace from Convex, ordered by orderIndex."""
    client = get_convex_client()

    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")

    cells_data = client.query(
        "sync:getCells",
        {"syncKey": INTERNAL_API_KEY, "workspaceId": workspace_id},
    )

    cells = []
    for c in cells_data:
        cells.append(
            Cell(
                id=c["_id"],
                yjs_cell_id=c["yjsCellId"],
                type=c["type"],
                content=c["content"],
                language=c.get("language"),
                order_index=c.get("orderIndex"),
                status=c["status"],
            )
        )

    cells.sort(
        key=lambda x: x.order_index if x.order_index is not None else float("inf")
    )
    return cells


async def save_cell_output(
    cell_id: str, yjs_cell_id: str, output_type: str, content: str
) -> None:
    """Save a cell output back to Convex."""
    client = get_convex_client()

    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")

    try:
        client.mutation(
            "sync:saveCellOutput",
            {
                "syncKey": INTERNAL_API_KEY,
                "cellId": cell_id,
                "yjsCellId": yjs_cell_id,
                "type": output_type,
                "content": content,
            },
        )
        print(f"[Output] Saved {output_type} for cell {cell_id}")
    except Exception as e:
        print(f"[Output] Failed to save output for {cell_id}: {e}")


async def clear_cell_outputs(cell_id: str) -> None:
    """Clear all outputs for a cell before re-execution."""
    client = get_convex_client()

    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")

    try:
        client.mutation(
            "sync:clearCellOutputs",
            {
                "syncKey": INTERNAL_API_KEY,
                "cellId": cell_id,
            },
        )
    except Exception as e:
        print(f"[Output] Failed to clear outputs for {cell_id}: {e}")


# ---------------------------------------------------------------------------
# Modal Code Execution
# ---------------------------------------------------------------------------


@app_modal.function(image=sandbox_image, timeout=300, gpu="T4")
def execute_python_in_sandbox(code_cells: list[dict], gpu: str = "T4") -> list[dict]:
    """
    Execute Python code cells in a Modal sandbox.

    Runs cells in order, maintaining state between cells (like a notebook).
    Returns outputs for each cell.

    Note: The gpu parameter is passed for logging/future use. The actual GPU
    is determined by the function decorator or spawn() call.
    """
    import base64
    import io
    import sys
    import traceback

    outputs = []
    namespace = {"__name__": "__main__"}

    for cell in code_cells:
        cell_id = cell["id"]
        yjs_cell_id = cell["yjs_cell_id"]
        code = cell["content"]

        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        cell_outputs = []

        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        try:
            exec(compile(code, f"<cell:{yjs_cell_id}>", "exec"), namespace)
        except Exception:
            cell_outputs.append(
                {
                    "cell_id": cell_id,
                    "yjs_cell_id": yjs_cell_id,
                    "type": "error",
                    "content": traceback.format_exc(),
                }
            )
        finally:
            # Restore stdout/stderr
            sys.stdout, sys.stderr = old_stdout, old_stderr

        # Capture stdout
        stdout_val = stdout_capture.getvalue()
        if stdout_val:
            cell_outputs.append(
                {
                    "cell_id": cell_id,
                    "yjs_cell_id": yjs_cell_id,
                    "type": "stdout",
                    "content": stdout_val,
                }
            )

        # Capture stderr
        stderr_val = stderr_capture.getvalue()
        if stderr_val:
            cell_outputs.append(
                {
                    "cell_id": cell_id,
                    "yjs_cell_id": yjs_cell_id,
                    "type": "stderr",
                    "content": stderr_val,
                }
            )

        # Check for matplotlib figures
        if "matplotlib" in sys.modules:
            import matplotlib.pyplot as plt

            figs = [plt.figure(i) for i in plt.get_fignums()]
            for fig in figs:
                buf = io.BytesIO()
                fig.savefig(buf, format="png", bbox_inches="tight")
                buf.seek(0)
                img_base64 = base64.b64encode(buf.read()).decode("utf-8")
                cell_outputs.append(
                    {
                        "cell_id": cell_id,
                        "yjs_cell_id": yjs_cell_id,
                        "type": "image",
                        "content": f"data:image/png;base64,{img_base64}",
                    }
                )
            plt.close("all")

        outputs.extend(cell_outputs)

    return outputs


async def run_cells_on_modal(cells: list[Cell], gpu: str = "T4") -> list[CellOutput]:
    """Run code cells on Modal and return outputs."""
    code_cells = [
        {
            "id": c.id,
            "yjs_cell_id": c.yjs_cell_id,
            "content": c.content,
        }
        for c in cells
        if c.type == "code" and (c.language is None or c.language == "python")
    ]

    if not code_cells:
        return []

    # Execute on Modal with dynamic GPU selection
    with app_modal.run():
        result = execute_python_in_sandbox.remote(code_cells, gpu)

    return [
        CellOutput(
            cell_id=o["cell_id"],
            yjs_cell_id=o["yjs_cell_id"],
            type=o["type"],
            content=o["content"],
        )
        for o in result
    ]


# ---------------------------------------------------------------------------
# FastAPI Application
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Convex client
    print(f"[Sandbox] Starting with CONVEX_URL: {CONVEX_URL}")
    if CONVEX_URL:
        get_convex_client()
    yield
    # Shutdown
    print("[Sandbox] Shutting down")


app = FastAPI(
    title="Parallel Sandbox Server",
    description="Execute notebook cells on Modal sandboxes",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {"status": "ok", "convex_configured": CONVEX_URL is not None}


@app.get("/workspace/{workspace_id}/cells")
async def get_workspace_cells(workspace_id: str) -> list[Cell]:
    """Load all cells for a workspace from Convex."""
    try:
        cells = await load_workspace_cells(workspace_id)
        return cells
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/execute")
async def execute_cells(request: ExecuteRequest) -> ExecuteResponse:
    """
    Execute code cells for a workspace.

    If cell_id is provided, executes all cells up to and including that cell.
    Otherwise, executes all code cells in the workspace.
    """
    try:
        # Load cells and GPU setting from Convex
        cells = await load_workspace_cells(request.workspace_id)
        gpu = await load_workspace_gpu(request.workspace_id)

        if not cells:
            return ExecuteResponse(success=True, outputs=[], error="No cells found")

        # If a specific cell_id is provided, only run cells up to that one
        if request.cell_id:
            target_idx = None
            for i, c in enumerate(cells):
                if c.id == request.cell_id or c.yjs_cell_id == request.cell_id:
                    target_idx = i
                    break
            if target_idx is None:
                raise HTTPException(status_code=404, detail="Cell not found")
            cells = cells[: target_idx + 1]

        # Clear existing outputs for cells we're about to execute
        code_cells = [c for c in cells if c.type == "code"]
        for cell in code_cells:
            await clear_cell_outputs(cell.id)

        # Execute on Modal with workspace GPU setting
        outputs = await run_cells_on_modal(cells, gpu)

        # Save outputs back to Convex
        for output in outputs:
            await save_cell_output(
                output.cell_id, output.yjs_cell_id, output.type, output.content
            )

        return ExecuteResponse(success=True, outputs=outputs)

    except HTTPException:
        raise
    except Exception as e:
        return ExecuteResponse(success=False, outputs=[], error=str(e))


@app.post("/execute/{workspace_id}/{cell_id}")
async def execute_single_cell(workspace_id: str, cell_id: str) -> ExecuteResponse:
    """Execute cells up to and including the specified cell."""
    return await execute_cells(
        ExecuteRequest(workspace_id=workspace_id, cell_id=cell_id)
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
