"""
Convex client and data operations.
"""

from typing import Any, Optional
from convex import ConvexClient

from ..models.schemas import Cell
from ..utils.config import CONVEX_URL, INTERNAL_API_KEY, GPU_TYPES
from ..utils.logging import logger

_convex_client: Optional[ConvexClient] = None


def get_convex_client() -> ConvexClient:
    """Get or create the Convex client singleton."""
    global _convex_client
    if _convex_client is None:
        if not CONVEX_URL:
            raise RuntimeError("CONVEX_URL not configured")
        _convex_client = ConvexClient(CONVEX_URL)
    return _convex_client


def _ensure_api_key() -> str:
    """Ensure INTERNAL_API_KEY is configured."""
    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY not configured")
    return INTERNAL_API_KEY


def get_workspace_gpu(workspace_id: str) -> str:
    """Load GPU setting for a workspace from Convex."""
    client = get_convex_client()
    api_key = _ensure_api_key()

    gpu = client.query(
        "sync:getWorkspaceGpu",
        {"syncKey": api_key, "workspaceId": workspace_id},
    )
    return gpu if gpu in GPU_TYPES else "T4"


def get_workspace_cells(workspace_id: str) -> list[Cell]:
    """Load all cells for a workspace from Convex, ordered by orderIndex."""
    client = get_convex_client()
    api_key = _ensure_api_key()

    cells_data = client.query(
        "sync:getCells",
        {"syncKey": api_key, "workspaceId": workspace_id},
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
    api_key = _ensure_api_key()

    try:
        client.mutation(
            "sync:saveCellOutput",
            {
                "syncKey": api_key,
                "cellId": cell_id,
                "yjsCellId": yjs_cell_id,
                "type": output_type,
                "content": content,
            },
        )
    except Exception as e:
        logger.error(f"Failed to save output: {e}")


def clear_cell_outputs(cell_id: str) -> None:
    """Clear all outputs for a cell before re-execution."""
    client = get_convex_client()
    api_key = _ensure_api_key()

    try:
        client.mutation(
            "sync:clearCellOutputs",
            {"syncKey": api_key, "cellId": cell_id},
        )
    except Exception as e:
        logger.error(f"Failed to clear outputs: {e}")


def get_workspace_kernel_id(workspace_id: str) -> Optional[str]:
    """Get the stored kernel sandbox ID for a workspace."""
    client = get_convex_client()
    api_key = _ensure_api_key()

    try:
        result = client.query(
            "sync:getWorkspaceKernel",
            {"syncKey": api_key, "workspaceId": workspace_id},
        )
        return result
    except Exception:
        return None


def set_workspace_kernel_id(workspace_id: str, sandbox_id: Optional[str]) -> None:
    """Store the kernel sandbox ID for a workspace."""
    client = get_convex_client()
    api_key = _ensure_api_key()

    try:
        args: dict[str, Any] = {
            "syncKey": api_key,
            "workspaceId": workspace_id,
        }
        if sandbox_id is not None:
            args["sandboxId"] = sandbox_id
        
        client.mutation("sync:setWorkspaceKernel", args)
    except Exception as e:
        logger.error(f"Failed to set kernel ID: {e}")
