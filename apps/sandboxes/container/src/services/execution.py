"""
Code execution service for Modal sandboxes.
"""

import json
from typing import AsyncGenerator

import modal

from ..utils.logging import logger
from ..utils.preprocessing import preprocess_ipython_magics
from .convex import save_cell_output


def _build_exec_wrapper(code: str, cell_id: str, yjs_cell_id: str) -> str:
    """Build the Python wrapper code for execution."""
    return f'''
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


def _build_streaming_wrapper(code: str, cell_id: str, yjs_cell_id: str) -> str:
    """Build the Python wrapper code for streaming execution."""
    return f'''
import json
import sys
import os
import ast
import base64
import traceback
from io import BytesIO, StringIO

# === NDJSON Output Helpers ===
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
            self.buffer += text
            while "\\n" in self.buffer:
                line, self.buffer = self.buffer.split("\\n", 1)
                if line:
                    emit("stdout", data=line + "\\n")
    
    def flush(self):
        if self.buffer:
            emit("stdout", data=self.buffer)
            self.buffer = ""

_streaming_stdout = StreamingStdout()
sys.stdout = _streaming_stdout

# === Matplotlib setup ===
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.show = lambda *args, **kwargs: None

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

_streaming_stdout.flush()

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
for img in images:
    emit("image", data=img)

if expr_result:
    emit("result", **expr_result)

if error_msg:
    emit("error", message=error_msg)

emit("done")
'''


async def execute_on_kernel(
    sandbox_id: str,
    cell_id: str,
    yjs_cell_id: str,
    code: str,
) -> dict:
    """Execute code on a kernel and return the result."""
    logger.info(f"Executing cell {yjs_cell_id[:8]}... on sandbox {sandbox_id[:16]}...")
    
    code = preprocess_ipython_magics(code)
    logger.debug(f"Code to execute:\n{code[:200]}{'...' if len(code) > 200 else ''}")
    
    sb = await modal.Sandbox.from_id.aio(sandbox_id)
    exec_wrapper = _build_exec_wrapper(code, cell_id, yjs_cell_id)
    
    process = await sb.exec.aio("python", "-c", exec_wrapper)
    
    output_lines = []
    async for line in process.stdout:
        output_lines.append(line)
    
    stderr_lines = []
    async for line in process.stderr:
        stderr_lines.append(line)
    
    await process.wait.aio()
    
    if not output_lines:
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
    
    try:
        result = json.loads(output_lines[-1])
        if stderr_lines:
            wrapper_stderr = "".join(stderr_lines)
            if result.get("stderr"):
                result["stderr"] += "\n" + wrapper_stderr
            else:
                result["stderr"] = wrapper_stderr
        return result
    except json.JSONDecodeError as e:
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
    """Execute code and stream output as NDJSON."""
    logger.info(f"Streaming execution for cell {yjs_cell_id[:8]}... on sandbox {sandbox_id[:16]}...")
    
    code = preprocess_ipython_magics(code)
    
    sb = await modal.Sandbox.from_id.aio(sandbox_id)
    exec_wrapper = _build_streaming_wrapper(code, cell_id, yjs_cell_id)
    
    process = await sb.exec.aio("python", "-u", "-c", exec_wrapper)
    
    # Accumulators for saving to Convex
    stdout_accumulator = ""
    images_collected = []
    result_collected = None
    error_collected = None
    line_buffer = ""
    
    async for chunk in process.stdout:
        line_buffer += chunk
        
        while "\n" in line_buffer:
            line, line_buffer = line_buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            
            try:
                event = json.loads(line)
                event_type = event.get("type", "unknown")
                
                if event_type == "stdout":
                    stdout_accumulator += event.get("data", "")
                elif event_type == "image":
                    images_collected.append(event.get("data", ""))
                elif event_type == "result":
                    result_collected = event
                elif event_type == "error":
                    error_collected = event.get("message", "")
                
                yield line + "\n"
                
            except json.JSONDecodeError:
                stdout_accumulator += line + "\n"
                yield json.dumps({"type": "stdout", "data": line + "\n"}) + "\n"
    
    if line_buffer.strip():
        line = line_buffer.strip()
        try:
            event = json.loads(line)
            yield line + "\n"
        except json.JSONDecodeError:
            yield json.dumps({"type": "stdout", "data": line + "\n"}) + "\n"
    
    stderr_lines = []
    async for line in process.stderr:
        stderr_lines.append(line)
    
    await process.wait.aio()
    
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


async def execute_bash(sandbox_id: str, command: str) -> dict:
    """Execute a bash command in a sandbox."""
    sb = await modal.Sandbox.from_id.aio(sandbox_id)
    
    process = await sb.exec.aio("bash", "-c", command)
    
    stdout_lines = []
    stderr_lines = []
    
    async for line in process.stdout:
        stdout_lines.append(line)
    
    async for line in process.stderr:
        stderr_lines.append(line)
    
    exit_code = await process.wait.aio()
    
    return {
        "success": exit_code == 0,
        "stdout": "".join(stdout_lines),
        "stderr": "".join(stderr_lines),
        "exit_code": exit_code,
    }
