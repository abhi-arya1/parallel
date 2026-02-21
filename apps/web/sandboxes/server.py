"""
Sandbox Server for Parallel

Manages persistent Modal Sandboxes (kernels) for notebook-style code execution.
Each workspace gets its own kernel that maintains state across cell executions.
"""

import json
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
# Configuration
# ---------------------------------------------------------------------------

CONVEX_URL = os.getenv("CONVEX_URL") or os.getenv("NEXT_PUBLIC_CONVEX_URL")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")

# Kernel timeout: 30 minutes of idle time before auto-termination
KERNEL_IDLE_TIMEOUT = 30 * 60  # seconds
KERNEL_MAX_TIMEOUT = 4 * 60 * 60  # 4 hours max lifetime

# GPU types supported by Modal
GPU_TYPES = ["T4", "L4", "A10", "A100", "A100-40GB", "A100-80GB", "L40S", "H100", "H200", "B200"]

convex_client: Optional[ConvexClient] = None


def get_convex_client() -> ConvexClient:
    global convex_client
    if convex_client is None:
        if not CONVEX_URL:
            raise RuntimeError("CONVEX_URL not configured")
        convex_client = ConvexClient(CONVEX_URL)
    return convex_client


# ---------------------------------------------------------------------------
# Modal Setup
# ---------------------------------------------------------------------------

# The sandbox image with data science packages
sandbox_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "numpy",
    "pandas",
    "matplotlib",
    "scikit-learn",
    "scipy",
    "seaborn",
)

# Modal app for managing sandboxes
modal_app = modal.App.lookup("parallel-kernels", create_if_missing=True)


# ---------------------------------------------------------------------------
# Kernel Driver Program
# ---------------------------------------------------------------------------

# This program runs inside the Modal Sandbox and listens for code on stdin,
# executes it, and returns results on stdout. State persists between executions.

KERNEL_DRIVER = '''
import json
import sys
import base64
import traceback
from io import StringIO, BytesIO
from contextlib import redirect_stdout, redirect_stderr

# Persistent namespace for all executions (like Jupyter)
_globals = {"__name__": "__main__"}

def capture_matplotlib():
    """Capture any matplotlib figures as base64 PNG images."""
    images = []
    if "matplotlib" in sys.modules:
        import matplotlib.pyplot as plt
        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            buf = BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
            buf.seek(0)
            img_b64 = base64.b64encode(buf.read()).decode("utf-8")
            images.append(f"data:image/png;base64,{img_b64}")
        plt.close("all")
    return images

while True:
    try:
        line = input()
        if not line:
            continue
        
        command = json.loads(line)
        code = command.get("code", "")
        cell_id = command.get("cell_id", "")
        yjs_cell_id = command.get("yjs_cell_id", "")
        
        stdout_buf = StringIO()
        stderr_buf = StringIO()
        error = None
        
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            try:
                exec(compile(code, f"<cell:{yjs_cell_id}>", "exec"), _globals)
            except Exception as e:
                error = traceback.format_exc()
        
        images = capture_matplotlib()
        
        result = {
            "cell_id": cell_id,
            "yjs_cell_id": yjs_cell_id,
            "stdout": stdout_buf.getvalue(),
            "stderr": stderr_buf.getvalue(),
            "error": error,
            "images": images,
        }
        
        print(json.dumps(result), flush=True)
        
    except EOFError:
        break
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
'''


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------


class Cell(BaseModel):
    id: str
    yjs_cell_id: str
    type: str
    content: str
    language: Optional[str] = None
    order_index: Optional[int] = None
    status: str


class CellOutput(BaseModel):
    cell_id: str
    yjs_cell_id: str
    type: str
    content: str


class ExecuteRequest(BaseModel):
    workspace_id: str
    cell_id: Optional[str] = None


class ExecuteResponse(BaseModel):
    success: bool
    outputs: list[CellOutput]
    error: Optional[str] = None


class KernelStatus(BaseModel):
    workspace_id: str
    sandbox_id: Optional[str]
    status: str  # "running" | "stopped" | "not_found"
    gpu: Optional[str]


class StartKernelRequest(BaseModel):
    workspace_id: str
    gpu: Optional[str] = "T4"


class StartKernelResponse(BaseModel):
    success: bool
    sandbox_id: Optional[str]
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Convex Data Operations
# ---------------------------------------------------------------------------


def get_workspace_gpu(workspace_id: str) -> str:
    """Load GPU setting for a workspace from Convex."""
    client = get_convex_client()
    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")

    gpu = client.query(
        "sync:getWorkspaceGpu",
        {"syncKey": INTERNAL_API_KEY, "workspaceId": workspace_id},
    )
    return gpu if gpu in GPU_TYPES else "T4"


def get_workspace_cells(workspace_id: str) -> list[Cell]:
    """Load all cells for a workspace from Convex, ordered by orderIndex."""
    client = get_convex_client()
    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")

    cells_data = client.query(
        "sync:getCells",
        {"syncKey": INTERNAL_API_KEY, "workspaceId": workspace_id},
    )

    cells = [
        Cell(
            id=c["_id"],
            yjs_cell_id=c["yjsCellId"],
            type=c["type"],
            content=c["content"],
            language=c.get("language"),
            order_index=c.get("orderIndex"),
            status=c["status"],
        )
        for c in cells_data
    ]

    cells.sort(key=lambda x: x.order_index if x.order_index is not None else float("inf"))
    return cells


def save_cell_output(cell_id: str, yjs_cell_id: str, output_type: str, content: str) -> None:
    """Save a cell output to Convex."""
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
    except Exception as e:
        print(f"[Kernel] Failed to save output: {e}")


def clear_cell_outputs(cell_id: str) -> None:
    """Clear all outputs for a cell before re-execution."""
    client = get_convex_client()
    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")

    try:
        client.mutation(
            "sync:clearCellOutputs",
            {"syncKey": INTERNAL_API_KEY, "cellId": cell_id},
        )
    except Exception as e:
        print(f"[Kernel] Failed to clear outputs: {e}")


def get_workspace_kernel_id(workspace_id: str) -> Optional[str]:
    """Get the stored kernel sandbox ID for a workspace."""
    client = get_convex_client()
    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")

    try:
        result = client.query(
            "sync:getWorkspaceKernel",
            {"syncKey": INTERNAL_API_KEY, "workspaceId": workspace_id},
        )
        return result
    except Exception:
        return None


def set_workspace_kernel_id(workspace_id: str, sandbox_id: Optional[str]) -> None:
    """Store the kernel sandbox ID for a workspace."""
    client = get_convex_client()
    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")

    try:
        client.mutation(
            "sync:setWorkspaceKernel",
            {
                "syncKey": INTERNAL_API_KEY,
                "workspaceId": workspace_id,
                "sandboxId": sandbox_id,
            },
        )
    except Exception as e:
        print(f"[Kernel] Failed to set kernel ID: {e}")


# ---------------------------------------------------------------------------
# Kernel Management
# ---------------------------------------------------------------------------

# In-memory cache of active kernel processes (sandbox_id -> process)
_kernel_processes: dict[str, tuple[modal.Sandbox, any]] = {}


def get_gpu_config(gpu: str) -> str:
    """Convert GPU string to Modal GPU config."""
    return gpu if gpu in GPU_TYPES else "T4"


def create_kernel(workspace_id: str, gpu: str = "T4") -> tuple[str, modal.Sandbox]:
    """Create a new Modal Sandbox kernel for a workspace."""
    print(f"[Kernel] Creating kernel for workspace {workspace_id} with GPU {gpu}")

    # Create sandbox with the kernel driver
    sb = modal.Sandbox.create(
        image=sandbox_image,
        gpu=get_gpu_config(gpu),
        timeout=KERNEL_MAX_TIMEOUT,
        idle_timeout=KERNEL_IDLE_TIMEOUT,
        app=modal_app,
    )

    # Start the kernel driver process
    process = sb.exec("python", "-c", KERNEL_DRIVER)

    # Cache the process
    _kernel_processes[sb.object_id] = (sb, process)

    # Store in Convex
    set_workspace_kernel_id(workspace_id, sb.object_id)

    print(f"[Kernel] Created kernel {sb.object_id} for workspace {workspace_id}")
    return sb.object_id, sb


def get_kernel(workspace_id: str) -> Optional[tuple[modal.Sandbox, any]]:
    """Get or reconnect to an existing kernel for a workspace."""
    sandbox_id = get_workspace_kernel_id(workspace_id)

    if not sandbox_id:
        return None

    # Check cache first
    if sandbox_id in _kernel_processes:
        return _kernel_processes[sandbox_id]

    # Try to reconnect to existing sandbox
    try:
        sb = modal.Sandbox.from_id(sandbox_id)
        # Start a new driver process (the old one may have finished)
        process = sb.exec("python", "-c", KERNEL_DRIVER)
        _kernel_processes[sandbox_id] = (sb, process)
        return (sb, process)
    except Exception as e:
        print(f"[Kernel] Failed to reconnect to kernel {sandbox_id}: {e}")
        # Clear the stale reference
        set_workspace_kernel_id(workspace_id, None)
        return None


def ensure_kernel(workspace_id: str, gpu: str = "T4") -> tuple[modal.Sandbox, any]:
    """Ensure a kernel exists for the workspace, creating one if needed."""
    existing = get_kernel(workspace_id)
    if existing:
        return existing

    sandbox_id, sb = create_kernel(workspace_id, gpu)
    return _kernel_processes[sandbox_id]


def execute_on_kernel(
    sb: modal.Sandbox,
    process: any,
    cell_id: str,
    yjs_cell_id: str,
    code: str,
) -> dict:
    """Execute code on a kernel and return the result."""
    command = json.dumps({
        "code": code,
        "cell_id": cell_id,
        "yjs_cell_id": yjs_cell_id,
    })

    # Write to stdin
    process.stdin.write(command + "\n")
    process.stdin.drain()

    # Read result from stdout
    result_line = next(iter(process.stdout))
    return json.loads(result_line)


def terminate_kernel(workspace_id: str) -> bool:
    """Terminate the kernel for a workspace."""
    sandbox_id = get_workspace_kernel_id(workspace_id)

    if not sandbox_id:
        return False

    try:
        # Remove from cache
        if sandbox_id in _kernel_processes:
            del _kernel_processes[sandbox_id]

        # Terminate the sandbox
        sb = modal.Sandbox.from_id(sandbox_id)
        sb.terminate()

        # Clear from Convex
        set_workspace_kernel_id(workspace_id, None)

        print(f"[Kernel] Terminated kernel {sandbox_id} for workspace {workspace_id}")
        return True
    except Exception as e:
        print(f"[Kernel] Failed to terminate kernel {sandbox_id}: {e}")
        set_workspace_kernel_id(workspace_id, None)
        return False


# ---------------------------------------------------------------------------
# FastAPI Application
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[Kernel Server] Starting with CONVEX_URL: {CONVEX_URL}")
    if CONVEX_URL:
        get_convex_client()
    yield
    print("[Kernel Server] Shutting down")


app = FastAPI(
    title="Parallel Kernel Server",
    description="Persistent notebook kernels on Modal Sandboxes",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {"status": "ok", "convex_configured": CONVEX_URL is not None}


@app.get("/kernel/{workspace_id}/status")
async def kernel_status(workspace_id: str) -> KernelStatus:
    """Get the status of a workspace's kernel."""
    sandbox_id = get_workspace_kernel_id(workspace_id)

    if not sandbox_id:
        return KernelStatus(
            workspace_id=workspace_id,
            sandbox_id=None,
            status="not_found",
            gpu=None,
        )

    try:
        sb = modal.Sandbox.from_id(sandbox_id)
        gpu = get_workspace_gpu(workspace_id)
        return KernelStatus(
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            status="running",
            gpu=gpu,
        )
    except Exception:
        set_workspace_kernel_id(workspace_id, None)
        return KernelStatus(
            workspace_id=workspace_id,
            sandbox_id=None,
            status="stopped",
            gpu=None,
        )


@app.post("/kernel/{workspace_id}/start")
async def start_kernel(workspace_id: str, request: StartKernelRequest = None) -> StartKernelResponse:
    """Start or restart a kernel for a workspace."""
    try:
        gpu = request.gpu if request else get_workspace_gpu(workspace_id)

        # Terminate existing kernel if any
        terminate_kernel(workspace_id)

        # Create new kernel
        sandbox_id, _ = create_kernel(workspace_id, gpu)

        return StartKernelResponse(success=True, sandbox_id=sandbox_id)
    except Exception as e:
        return StartKernelResponse(success=False, sandbox_id=None, error=str(e))


@app.post("/kernel/{workspace_id}/stop")
async def stop_kernel(workspace_id: str):
    """Stop a workspace's kernel."""
    success = terminate_kernel(workspace_id)
    return {"success": success}


@app.post("/kernel/{workspace_id}/restart")
async def restart_kernel(workspace_id: str) -> StartKernelResponse:
    """Restart a workspace's kernel (clears all state)."""
    gpu = get_workspace_gpu(workspace_id)
    terminate_kernel(workspace_id)
    sandbox_id, _ = create_kernel(workspace_id, gpu)
    return StartKernelResponse(success=True, sandbox_id=sandbox_id)


@app.post("/execute")
async def execute_cells(request: ExecuteRequest) -> ExecuteResponse:
    """
    Execute code cells for a workspace.

    If cell_id is provided, executes only that cell.
    Otherwise, executes all code cells in the workspace in order.
    """
    try:
        workspace_id = request.workspace_id
        gpu = get_workspace_gpu(workspace_id)

        # Ensure kernel is running
        sb, process = ensure_kernel(workspace_id, gpu)

        # Load cells from Convex
        cells = get_workspace_cells(workspace_id)

        if not cells:
            return ExecuteResponse(success=True, outputs=[], error="No cells found")

        # Filter to requested cell(s)
        if request.cell_id:
            cells = [c for c in cells if c.id == request.cell_id or c.yjs_cell_id == request.cell_id]
            if not cells:
                raise HTTPException(status_code=404, detail="Cell not found")

        # Filter to Python code cells only
        code_cells = [c for c in cells if c.type == "code" and (c.language is None or c.language == "python")]

        if not code_cells:
            return ExecuteResponse(success=True, outputs=[], error="No Python code cells to execute")

        all_outputs: list[CellOutput] = []

        for cell in code_cells:
            # Clear previous outputs
            clear_cell_outputs(cell.id)

            # Execute on kernel
            try:
                result = execute_on_kernel(sb, process, cell.id, cell.yjs_cell_id, cell.content)
            except StopIteration:
                # Kernel process ended, restart and retry
                print(f"[Kernel] Process ended, restarting kernel for {workspace_id}")
                terminate_kernel(workspace_id)
                sb, process = ensure_kernel(workspace_id, gpu)
                result = execute_on_kernel(sb, process, cell.id, cell.yjs_cell_id, cell.content)

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

        return ExecuteResponse(success=True, outputs=all_outputs)

    except HTTPException:
        raise
    except Exception as e:
        return ExecuteResponse(success=False, outputs=[], error=str(e))


@app.post("/execute/{workspace_id}/{cell_id}")
async def execute_single_cell(workspace_id: str, cell_id: str) -> ExecuteResponse:
    """Execute a single cell."""
    return await execute_cells(ExecuteRequest(workspace_id=workspace_id, cell_id=cell_id))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
