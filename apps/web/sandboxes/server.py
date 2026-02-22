"""
Sandbox Server for Parallel

Manages persistent Modal Sandboxes (kernels) for notebook-style code execution.
Each workspace gets its own kernel that maintains state across cell executions.
"""

import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Optional

import modal
import modal.exception
from convex import ConvexClient
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv(".env.local")

# ---------------------------------------------------------------------------
# Logging Setup
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("sandbox")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONVEX_URL = os.getenv("CONVEX_URL") or os.getenv("NEXT_PUBLIC_CONVEX_URL")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")

# Kernel timeout: 30 minutes of idle time before auto-termination
KERNEL_IDLE_TIMEOUT = 30 * 60  # seconds
KERNEL_MAX_TIMEOUT = 4 * 60 * 60  # 4 hours max lifetime

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

import re


def preprocess_ipython_magics(code: str) -> str:
    """
    Transform IPython magic commands into valid Python code.

    Supports:
    - !command  -> subprocess shell execution
    - %pip install pkg -> subprocess pip
    - %cd path -> os.chdir
    - Other % magics are commented out with a warning
    """
    lines = code.split("\n")
    result = []

    for line in lines:
        stripped = line.lstrip()
        indent = line[: len(line) - len(stripped)]

        if stripped.startswith("!"):
            cmd = stripped[1:]
            result.append(
                f"{indent}import subprocess; subprocess.run({repr(cmd)}, shell=True)"
            )
        elif stripped.startswith("%%"):
            result.append(f"{indent}# Cell magic not supported: {stripped}")
        elif stripped.startswith("%pip ") or stripped.startswith("%pip\t"):
            args = stripped[5:].strip()
            result.append(
                f'{indent}import subprocess; subprocess.run(["pip", {", ".join(repr(a) for a in args.split())}])'
            )
        elif stripped.startswith("%conda "):
            args = stripped[7:].strip()
            result.append(
                f'{indent}import subprocess; subprocess.run(["conda", {", ".join(repr(a) for a in args.split())}])'
            )
        elif stripped.startswith("%cd "):
            path = stripped[4:].strip()
            result.append(f"{indent}import os; os.chdir({repr(path)})")
        elif stripped.startswith("%env "):
            env_expr = stripped[5:].strip()
            if "=" in env_expr:
                key, val = env_expr.split("=", 1)
                result.append(
                    f"{indent}import os; os.environ[{repr(key.strip())}] = {repr(val.strip())}"
                )
            else:
                result.append(
                    f'{indent}import os; print(os.environ.get({repr(env_expr)}, ""))'
                )
        elif stripped.startswith("%"):
            result.append(f"{indent}# Line magic not supported: {stripped}")
        else:
            result.append(line)

    return "\n".join(result)


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

    cells.sort(
        key=lambda x: x.order_index if x.order_index is not None else float("inf")
    )
    return cells


def save_cell_output(
    cell_id: str, yjs_cell_id: str, output_type: str, content: str
) -> None:
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
        # Build args - only include sandboxId if it's not None
        args: dict[str, Any] = {
            "syncKey": INTERNAL_API_KEY,
            "workspaceId": workspace_id,
        }
        if sandbox_id is not None:
            args["sandboxId"] = sandbox_id

        client.mutation("sync:setWorkspaceKernel", args)
    except Exception as e:
        print(f"[Kernel] Failed to set kernel ID: {e}")


# ---------------------------------------------------------------------------
# Kernel Management
# ---------------------------------------------------------------------------


def get_gpu_config(gpu: str) -> str:
    """Convert GPU string to Modal GPU config."""
    return gpu if gpu in GPU_TYPES else "T4"


async def create_sandbox(workspace_id: str, gpu: str = "T4") -> str:
    """Create a new Modal Sandbox for a workspace."""
    logger.info(f"Creating sandbox for workspace {workspace_id} with GPU {gpu}")

    # Create sandbox (async)
    sb = await modal.Sandbox.create.aio(
        image=sandbox_image,
        gpu=get_gpu_config(gpu),
        timeout=KERNEL_MAX_TIMEOUT,
        idle_timeout=KERNEL_IDLE_TIMEOUT,
        app=modal_app,
    )

    # Store in Convex
    set_workspace_kernel_id(workspace_id, sb.object_id)

    logger.info(f"Created sandbox {sb.object_id} for workspace {workspace_id}")
    return sb.object_id


async def get_sandbox_id(workspace_id: str) -> Optional[str]:
    """Get the sandbox ID for a workspace, verifying it's still valid."""
    sandbox_id = get_workspace_kernel_id(workspace_id)

    if not sandbox_id:
        logger.debug(f"No sandbox found for workspace {workspace_id}")
        return None

    # Verify sandbox is still accessible
    try:
        await modal.Sandbox.from_id.aio(sandbox_id)
        logger.debug(f"Sandbox {sandbox_id} is valid for workspace {workspace_id}")
        return sandbox_id
    except Exception as e:
        logger.warning(f"Sandbox {sandbox_id} no longer valid: {e}")
        set_workspace_kernel_id(workspace_id, None)
        return None


async def ensure_sandbox(workspace_id: str, gpu: str = "T4") -> str:
    """Ensure a sandbox exists for the workspace, creating one if needed."""
    existing = await get_sandbox_id(workspace_id)
    if existing:
        logger.debug(f"Using existing sandbox {existing} for workspace {workspace_id}")
        return existing

    logger.info(f"No existing sandbox, creating new one for workspace {workspace_id}")
    return await create_sandbox(workspace_id, gpu)


async def execute_on_kernel(
    sandbox_id: str,
    cell_id: str,
    yjs_cell_id: str,
    code: str,
) -> dict:
    """Execute code on a kernel and return the result.

    Creates a fresh exec process for each execution since Modal's stdout
    iterator consumes until EOF, which doesn't work for persistent REPL-style
    communication.
    """
    logger.info(f"Executing cell {yjs_cell_id[:8]}... on sandbox {sandbox_id[:16]}...")

    # Preprocess IPython magic commands
    code = preprocess_ipython_magics(code)
    logger.debug(f"Code to execute:\n{code[:200]}{'...' if len(code) > 200 else ''}")

    # Get the sandbox
    sb = await modal.Sandbox.from_id.aio(sandbox_id)

    # Build wrapper that executes the code and exits
    # This avoids the stdin/stdout streaming issues with Modal
    exec_wrapper = f'''
import json
import sys
import ast
import base64
import traceback
from io import StringIO, BytesIO
from contextlib import redirect_stdout, redirect_stderr

# Configure matplotlib for headless operation BEFORE any user imports
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Patch plt.show() to be a no-op (we capture figures after execution)
_original_show = plt.show
def _patched_show(*args, **kwargs):
    pass  # Do nothing - we'll capture figures after code execution
plt.show = _patched_show

# Load persisted globals if they exist
try:
    import pickle
    with open("/tmp/kernel_state.pkl", "rb") as f:
        _globals = pickle.load(f)
except Exception:
    _globals = {{"__name__": "__main__"}}

# Pre-populate globals with matplotlib so user imports work
_globals["matplotlib"] = matplotlib
_globals["plt"] = plt

def capture_matplotlib():
    """Capture any matplotlib figures as base64 PNG images."""
    images = []
    for fig_num in plt.get_fignums():
        fig = plt.figure(fig_num)
        buf = BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
        buf.seek(0)
        img_b64 = base64.b64encode(buf.read()).decode("utf-8")
        images.append("data:image/png;base64," + img_b64)
    plt.close("all")
    return images

def format_result(value):
    """Format a result value for display, similar to Jupyter."""
    if value is None:
        return None

    if "pandas" in sys.modules:
        import pandas as pd
        if isinstance(value, (pd.DataFrame, pd.Series)):
            return {{"type": "dataframe", "content": value.to_json(orient="records")}}

    try:
        result_str = repr(value)
        if result_str.startswith("<") and "object at 0x" in result_str:
            return None
        return {{"type": "result", "content": result_str}}
    except Exception:
        return None

def execute_with_result(code, filename, globals_dict):
    try:
        tree = ast.parse(code)
    except SyntaxError:
        exec(compile(code, filename, "exec"), globals_dict)
        return None

    if not tree.body:
        return None

    last = tree.body[-1]
    last_expr_value = None

    if isinstance(last, ast.Expr):
        if len(tree.body) > 1:
            mod = ast.Module(body=tree.body[:-1], type_ignores=[])
            exec(compile(mod, filename, "exec"), globals_dict)
        expr = ast.Expression(body=last.value)
        last_expr_value = eval(compile(expr, filename, "eval"), globals_dict)
    else:
        exec(compile(tree, filename, "exec"), globals_dict)

    return last_expr_value

code = {repr(code)}
cell_id = {repr(cell_id)}
yjs_cell_id = {repr(yjs_cell_id)}

stdout_buf = StringIO()
stderr_buf = StringIO()
error = None
expr_result = None

with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
    try:
        last_value = execute_with_result(code, f"<cell:{{yjs_cell_id}}>", _globals)
        if last_value is not None:
            expr_result = format_result(last_value)
    except Exception as e:
        error = traceback.format_exc()

images = capture_matplotlib()

# Persist globals for next execution (filter out non-picklable items)
try:
    import pickle
    # Filter to only picklable items
    saveable = {{}}
    for k, v in _globals.items():
        if k.startswith("_"):
            continue
        try:
            pickle.dumps(v)
            saveable[k] = v
        except Exception:
            pass
    saveable["__name__"] = "__main__"
    with open("/tmp/kernel_state.pkl", "wb") as f:
        pickle.dump(saveable, f)
except Exception:
    pass

result = {{
    "cell_id": cell_id,
    "yjs_cell_id": yjs_cell_id,
    "stdout": stdout_buf.getvalue(),
    "stderr": stderr_buf.getvalue(),
    "error": error,
    "images": images,
    "result": expr_result,
}}

print(json.dumps(result))
'''

    # Execute wrapper and collect output
    process = await sb.exec.aio("python", "-c", exec_wrapper)

    output_lines = []
    async for line in process.stdout:
        output_lines.append(line)

    stderr_lines = []
    async for line in process.stderr:
        stderr_lines.append(line)

    # Wait for process to complete
    await process.wait.aio()

    if not output_lines:
        # No stdout - return stderr as error
        error_msg = "".join(stderr_lines) if stderr_lines else "No output from kernel"
        return {
            "cell_id": cell_id,
            "yjs_cell_id": yjs_cell_id,
            "stdout": "",
            "stderr": "",
            "error": error_msg,
            "images": [],
            "result": None,
        }

    # Try to parse the last line as JSON result
    try:
        result = json.loads(output_lines[-1])
        # If there was stderr from the wrapper itself (not user code), append it
        if stderr_lines:
            wrapper_stderr = "".join(stderr_lines)
            if result.get("stderr"):
                result["stderr"] += "\n" + wrapper_stderr
            else:
                result["stderr"] = wrapper_stderr
        return result
    except json.JSONDecodeError as e:
        # Output wasn't valid JSON - return raw output as error
        all_output = "".join(output_lines)
        all_stderr = "".join(stderr_lines)
        return {
            "cell_id": cell_id,
            "yjs_cell_id": yjs_cell_id,
            "stdout": all_output,
            "stderr": all_stderr,
            "error": f"Kernel output parse error: {e}\nRaw output: {all_output[:500]}",
            "images": [],
            "result": None,
        }


async def stream_execute_on_kernel(
    sandbox_id: str,
    cell_id: str,
    yjs_cell_id: str,
    code: str,
) -> AsyncGenerator[str, None]:
    """Execute code and stream output as NDJSON (newline-delimited JSON).

    Each line is a complete JSON object with a "type" field:
    - {"type": "stdout", "data": "..."} - Print output
    - {"type": "stderr", "data": "..."} - Error output
    - {"type": "image", "data": "base64..."} - Matplotlib image
    - {"type": "result", "content": "...", "format": "..."} - Expression result
    - {"type": "error", "message": "..."} - Execution error
    - {"type": "done"} - Execution complete
    """
    logger.info(
        f"Streaming execution for cell {yjs_cell_id[:8]}... on sandbox {sandbox_id[:16]}..."
    )

    # Preprocess IPython magic commands
    code = preprocess_ipython_magics(code)

    sb = await modal.Sandbox.from_id.aio(sandbox_id)

    # Clean, simple Python wrapper that outputs NDJSON
    # Key insight: we use a custom stdout class that emits JSON for each write
    exec_wrapper = f'''
import json
import sys
import os
import ast
import base64
import traceback
from io import BytesIO, StringIO

# === NDJSON Output Helpers ===
# Use os.write to fd 1 directly - this is the most reliable way to bypass
# any Python-level stdout redirections that Modal might set up
def emit(event_type, **data):
    """Emit a NDJSON event directly to fd 1 using os.write."""
    event = {{"type": event_type, **data}}
    line = json.dumps(event) + "\\n"
    os.write(1, line.encode("utf-8"))

# === Streaming stdout wrapper ===
class StreamingStdout:
    """Custom stdout that emits each write as a JSON event."""
    def __init__(self):
        self.buffer = ""

    def write(self, text):
        if text:
            # Buffer text and emit complete lines
            self.buffer += text
            while "\\n" in self.buffer:
                line, self.buffer = self.buffer.split("\\n", 1)
                if line:  # Don't emit empty lines
                    emit("stdout", data=line + "\\n")

    def flush(self):
        # Flush any remaining buffered content
        if self.buffer:
            emit("stdout", data=self.buffer)
            self.buffer = ""

# Install streaming stdout for user code's print() calls
_streaming_stdout = StreamingStdout()
sys.stdout = _streaming_stdout

# === Matplotlib setup ===
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.show = lambda *args, **kwargs: None  # No-op

# === Load persisted state ===
try:
    import pickle
    with open("/tmp/kernel_state.pkl", "rb") as f:
        _globals = pickle.load(f)
except Exception:
    _globals = {{"__name__": "__main__"}}

_globals["matplotlib"] = matplotlib
_globals["plt"] = plt

# === Helper functions ===
def capture_matplotlib():
    """Capture matplotlib figures as base64 PNG images."""
    images = []
    for fig_num in plt.get_fignums():
        fig = plt.figure(fig_num)
        buf = BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
        buf.seek(0)
        img_b64 = base64.b64encode(buf.read()).decode("utf-8")
        images.append("data:image/png;base64," + img_b64)
    plt.close("all")
    return images

def format_result(value):
    """Format a Python value for display."""
    if value is None:
        return None
    if "pandas" in sys.modules:
        import pandas as pd
        if isinstance(value, (pd.DataFrame, pd.Series)):
            return {{"format": "dataframe", "content": value.to_json(orient="records")}}
    try:
        result_str = repr(value)
        if result_str.startswith("<") and "object at 0x" in result_str:
            return None
        return {{"format": "text", "content": result_str}}
    except Exception:
        return None

def execute_with_result(code, filename, globals_dict):
    """Execute code and return the last expression's value if any."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        exec(compile(code, filename, "exec"), globals_dict)
        return None
    if not tree.body:
        return None
    last = tree.body[-1]
    if isinstance(last, ast.Expr):
        if len(tree.body) > 1:
            mod = ast.Module(body=tree.body[:-1], type_ignores=[])
            exec(compile(mod, filename, "exec"), globals_dict)
        expr = ast.Expression(body=last.value)
        return eval(compile(expr, filename, "eval"), globals_dict)
    else:
        exec(compile(tree, filename, "exec"), globals_dict)
    return None

# === Execute user code ===
code = {repr(code)}
cell_id = {repr(cell_id)}
yjs_cell_id = {repr(yjs_cell_id)}

error_msg = None
expr_result = None

try:
    last_value = execute_with_result(code, f"<cell:{{yjs_cell_id}}>", _globals)
    if last_value is not None:
        expr_result = format_result(last_value)
except Exception:
    error_msg = traceback.format_exc()

# Flush any remaining stdout from user code
_streaming_stdout.flush()

# Capture matplotlib figures
images = capture_matplotlib()

# === Persist globals for next execution ===
try:
    import pickle
    saveable = {{}}
    for k, v in _globals.items():
        if k.startswith("_"):
            continue
        try:
            pickle.dumps(v)
            saveable[k] = v
        except Exception:
            pass
    saveable["__name__"] = "__main__"
    with open("/tmp/kernel_state.pkl", "wb") as f:
        pickle.dump(saveable, f)
except Exception:
    pass

# === Emit final events ===
# Emit images
for img in images:
    emit("image", data=img)

# Emit result
if expr_result:
    emit("result", **expr_result)

# Emit error
if error_msg:
    emit("error", message=error_msg)

# Signal completion
emit("done")
'''

    process = await sb.exec.aio("python", "-u", "-c", exec_wrapper)

    # Accumulators for saving to Convex
    stdout_accumulator = ""
    images_collected = []
    result_collected = None
    error_collected = None

    # Buffer for incomplete lines from Modal's stdout
    line_buffer = ""

    # Stream stdout from Modal - NOTE: Modal may yield multiple lines at once
    # or partial lines, so we need to buffer and split by newlines
    async for chunk in process.stdout:
        line_buffer += chunk

        # Process complete lines
        while "\n" in line_buffer:
            line, line_buffer = line_buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue

            try:
                event = json.loads(line)
                event_type = event.get("type", "unknown")

                # Accumulate outputs for Convex persistence
                if event_type == "stdout":
                    stdout_accumulator += event.get("data", "")
                elif event_type == "image":
                    images_collected.append(event.get("data", ""))
                elif event_type == "result":
                    result_collected = event
                elif event_type == "error":
                    error_collected = event.get("message", "")

                # Yield the event as NDJSON
                yield line + "\n"

            except json.JSONDecodeError:
                # Non-JSON output (shouldn't happen, but handle gracefully)
                stdout_accumulator += line + "\n"
                yield json.dumps({"type": "stdout", "data": line + "\n"}) + "\n"

    # Process any remaining content in buffer
    if line_buffer.strip():
        line = line_buffer.strip()
        try:
            event = json.loads(line)
            yield line + "\n"
        except json.JSONDecodeError:
            yield json.dumps({"type": "stdout", "data": line + "\n"}) + "\n"

    # Collect any stderr from the process itself (not user code)
    stderr_lines = []
    async for line in process.stderr:
        stderr_lines.append(line)

    await process.wait.aio()

    # If there was process-level stderr, emit it
    if stderr_lines:
        stderr_content = "".join(stderr_lines)
        yield json.dumps({"type": "stderr", "data": stderr_content}) + "\n"

    # Save outputs to Convex
    if stdout_accumulator:
        save_cell_output(cell_id, yjs_cell_id, "stdout", stdout_accumulator)
    for img in images_collected:
        save_cell_output(cell_id, yjs_cell_id, "image", img)
    if result_collected:
        fmt = result_collected.get("format", "text")
        content = result_collected.get("content", "")
        output_type = "dataframe" if fmt == "dataframe" else "result"
        save_cell_output(cell_id, yjs_cell_id, output_type, content)
    if error_collected:
        save_cell_output(cell_id, yjs_cell_id, "error", error_collected)
    if stderr_lines:
        save_cell_output(cell_id, yjs_cell_id, "stderr", "".join(stderr_lines))


async def terminate_kernel(workspace_id: str) -> bool:
    """Terminate the sandbox for a workspace."""
    sandbox_id = get_workspace_kernel_id(workspace_id)

    if not sandbox_id:
        return False

    try:
        # Terminate the sandbox (async)
        sb = await modal.Sandbox.from_id.aio(sandbox_id)
        await sb.terminate.aio()

        # Clear from Convex
        set_workspace_kernel_id(workspace_id, None)

        logger.info(f"Terminated sandbox {sandbox_id} for workspace {workspace_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to terminate sandbox {sandbox_id}: {e}")
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

# Add CORS middleware - fully permissive
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
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
        sb = await modal.Sandbox.from_id.aio(sandbox_id)
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
async def start_kernel(
    workspace_id: str, request: Optional[StartKernelRequest] = None
) -> StartKernelResponse:
    """Start or restart a sandbox for a workspace."""
    try:
        gpu = (
            request.gpu if request and request.gpu else get_workspace_gpu(workspace_id)
        )

        # Terminate existing sandbox if any
        await terminate_kernel(workspace_id)

        # Create new sandbox
        sandbox_id = await create_sandbox(workspace_id, gpu)

        return StartKernelResponse(success=True, sandbox_id=sandbox_id)
    except Exception as e:
        return StartKernelResponse(success=False, sandbox_id=None, error=str(e))


@app.post("/kernel/{workspace_id}/stop")
async def stop_kernel(workspace_id: str):
    """Stop a workspace's sandbox."""
    success = await terminate_kernel(workspace_id)
    return {"success": success}


@app.post("/kernel/{workspace_id}/restart")
async def restart_kernel(workspace_id: str) -> StartKernelResponse:
    """Restart a workspace's sandbox (clears all state)."""
    gpu = get_workspace_gpu(workspace_id)
    await terminate_kernel(workspace_id)
    sandbox_id = await create_sandbox(workspace_id, gpu)
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

        # Ensure sandbox is running (creates if needed)
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
                # Sandbox expired, recreate and retry
                logger.warning(f"Sandbox expired, recreating: {e}")
                await terminate_kernel(workspace_id)
                sandbox_id = await create_sandbox(workspace_id, gpu)
                result = await execute_on_kernel(
                    sandbox_id, cell.id, cell.yjs_cell_id, cell.content
                )
            except Exception as e:
                # Other error, try recreating sandbox
                logger.error(
                    f"Execution failed, recreating sandbox for {workspace_id}: {e}"
                )
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

            # Handle expression result (last value like Jupyter Out[n])
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


@app.post("/execute/{workspace_id}/{cell_id}")
async def execute_single_cell(workspace_id: str, cell_id: str) -> ExecuteResponse:
    """Execute a single cell."""
    return await execute_cells(
        ExecuteRequest(workspace_id=workspace_id, cell_id=cell_id)
    )


@app.get("/stream/{workspace_id}/{cell_id}")
async def stream_execute_cell(workspace_id: str, cell_id: str):
    """Execute a single cell with streaming output via NDJSON.

    Returns a newline-delimited JSON stream with real-time output.
    Each line is a complete JSON object with a "type" field:
    - {"type": "stdout", "data": "..."} - Print output
    - {"type": "stderr", "data": "..."} - Error output
    - {"type": "image", "data": "base64..."} - Matplotlib image
    - {"type": "result", "content": "...", "format": "..."} - Expression result
    - {"type": "error", "message": "..."} - Execution error
    - {"type": "done"} - Execution complete
    """
    logger.info(f"Stream requested for workspace {workspace_id}, cell {cell_id}")

    async def event_generator():
        try:
            gpu = get_workspace_gpu(workspace_id)
            sandbox_id = await ensure_sandbox(workspace_id, gpu)

            # Get cell content from Convex
            cells = get_workspace_cells(workspace_id)
            cell = next(
                (c for c in cells if c.id == cell_id or c.yjs_cell_id == cell_id), None
            )

            if not cell:
                yield json.dumps({"type": "error", "message": "Cell not found"}) + "\n"
                yield json.dumps({"type": "done"}) + "\n"
                return

            if cell.type != "code":
                yield json.dumps({"type": "error", "message": "Not a code cell"}) + "\n"
                yield json.dumps({"type": "done"}) + "\n"
                return

            # Clear previous outputs
            clear_cell_outputs(cell.id)

            # Stream execution with retry on sandbox expiry
            retried = False
            while True:
                try:
                    async for event in stream_execute_on_kernel(
                        sandbox_id, cell.id, cell.yjs_cell_id, cell.content
                    ):
                        yield event
                    break  # Success, exit loop
                except modal.exception.NotFoundError as e:
                    if retried:
                        raise  # Already retried, give up
                    # Sandbox expired, recreate and retry
                    logger.warning(f"Sandbox expired, recreating: {e}")
                    yield (
                        json.dumps({"type": "stdout", "data": "[Starting Kernel...]\n"})
                        + "\n"
                    )
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
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


class BashExecuteRequest(BaseModel):
    workspace_id: str
    command: str
    agent_mode: bool = False


class BashExecuteResponse(BaseModel):
    success: bool
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0
    error: Optional[str] = None


@app.post("/bash")
async def execute_bash(request: BashExecuteRequest) -> BashExecuteResponse:
    """Execute a bash command in the workspace sandbox."""
    try:
        workspace_id = request.workspace_id
        gpu = get_workspace_gpu(workspace_id)
        sandbox_id = await ensure_sandbox(workspace_id, gpu)

        sb = await modal.Sandbox.from_id.aio(sandbox_id)

        process = await sb.exec.aio("bash", "-c", request.command)

        stdout_lines = []
        stderr_lines = []

        async for line in process.stdout:
            stdout_lines.append(line)

        async for line in process.stderr:
            stderr_lines.append(line)

        exit_code = await process.wait.aio()

        return BashExecuteResponse(
            success=exit_code == 0,
            stdout="".join(stdout_lines),
            stderr="".join(stderr_lines),
            exit_code=exit_code,
        )

    except Exception as e:
        logger.exception(f"Bash execution error: {e}")
        return BashExecuteResponse(
            success=False,
            error=str(e),
            exit_code=-1,
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
