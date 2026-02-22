"""
Kernel management endpoints.
"""

from typing import Optional
from fastapi import APIRouter

from ..models.schemas import KernelStatus, StartKernelRequest, StartKernelResponse
from ..services.convex import get_workspace_gpu, get_workspace_kernel_id, set_workspace_kernel_id
from ..services.modal_sandbox import create_sandbox, terminate_kernel, get_sandbox

router = APIRouter(prefix="/kernel")


@router.get("/{workspace_id}/status")
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
        await get_sandbox(sandbox_id)
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


@router.post("/{workspace_id}/start")
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


@router.post("/{workspace_id}/stop")
async def stop_kernel(workspace_id: str):
    """Stop a workspace's sandbox."""
    success = await terminate_kernel(workspace_id)
    return {"success": success}


@router.post("/{workspace_id}/restart")
async def restart_kernel(workspace_id: str) -> StartKernelResponse:
    """Restart a workspace's sandbox (clears all state)."""
    gpu = get_workspace_gpu(workspace_id)
    await terminate_kernel(workspace_id)
    sandbox_id = await create_sandbox(workspace_id, gpu)
    return StartKernelResponse(success=True, sandbox_id=sandbox_id)
