"""
Pydantic models for request/response schemas.
"""

from typing import Optional
from pydantic import BaseModel


class Cell(BaseModel):
    """Represents a notebook cell."""
    id: str
    yjs_cell_id: str
    type: str
    content: str
    language: Optional[str] = None
    order_index: Optional[int] = None
    status: str


class CellOutput(BaseModel):
    """Output from executing a cell."""
    cell_id: str
    yjs_cell_id: str
    type: str  # stdout, stderr, error, image, result, dataframe
    content: str


class ExecuteRequest(BaseModel):
    """Request to execute cells in a workspace."""
    workspace_id: str
    cell_id: Optional[str] = None


class ExecuteResponse(BaseModel):
    """Response from cell execution."""
    success: bool
    outputs: list[CellOutput]
    error: Optional[str] = None


class KernelStatus(BaseModel):
    """Status of a workspace kernel."""
    workspace_id: str
    sandbox_id: Optional[str]
    status: str  # running, stopped, not_found
    gpu: Optional[str]


class StartKernelRequest(BaseModel):
    """Request to start a kernel."""
    workspace_id: str
    gpu: Optional[str] = "T4"


class StartKernelResponse(BaseModel):
    """Response from starting a kernel."""
    success: bool
    sandbox_id: Optional[str]
    error: Optional[str] = None


class BashExecuteRequest(BaseModel):
    """Request to execute a bash command."""
    workspace_id: str
    command: str
    agent_mode: bool = False


class BashExecuteResponse(BaseModel):
    """Response from bash execution."""
    success: bool
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0
    error: Optional[str] = None


class ExecutionResult(BaseModel):
    """Internal result from kernel execution."""
    cell_id: str
    yjs_cell_id: str
    stdout: str = ""
    stderr: str = ""
    error: Optional[str] = None
    images: list[str] = []
    result: Optional[dict] = None
