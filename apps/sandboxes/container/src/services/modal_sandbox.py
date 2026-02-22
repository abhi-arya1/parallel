"""
Modal Sandbox management service.
"""

from typing import Optional
import modal

from ..utils.config import KERNEL_IDLE_TIMEOUT, KERNEL_MAX_TIMEOUT, GPU_TYPES
from ..utils.logging import logger
from .convex import get_workspace_kernel_id, set_workspace_kernel_id

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


def get_gpu_config(gpu: str) -> str:
    """Convert GPU string to Modal GPU config."""
    return gpu if gpu in GPU_TYPES else "T4"


async def create_sandbox(workspace_id: str, gpu: str = "T4") -> str:
    """Create a new Modal Sandbox for a workspace."""
    logger.info(f"Creating sandbox for workspace {workspace_id} with GPU {gpu}")

    sb = await modal.Sandbox.create.aio(
        image=sandbox_image,
        gpu=get_gpu_config(gpu),
        timeout=KERNEL_MAX_TIMEOUT,
        idle_timeout=KERNEL_IDLE_TIMEOUT,
        app=modal_app,
    )

    set_workspace_kernel_id(workspace_id, sb.object_id)

    logger.info(f"Created sandbox {sb.object_id} for workspace {workspace_id}")
    return sb.object_id


async def get_sandbox_id(workspace_id: str) -> Optional[str]:
    """Get the sandbox ID for a workspace, verifying it's still valid."""
    sandbox_id = get_workspace_kernel_id(workspace_id)

    if not sandbox_id:
        logger.debug(f"No sandbox found for workspace {workspace_id}")
        return None

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


async def terminate_kernel(workspace_id: str) -> bool:
    """Terminate the sandbox for a workspace."""
    sandbox_id = get_workspace_kernel_id(workspace_id)

    if not sandbox_id:
        return False

    try:
        sb = await modal.Sandbox.from_id.aio(sandbox_id)
        await sb.terminate.aio()
        set_workspace_kernel_id(workspace_id, None)
        logger.info(f"Terminated sandbox {sandbox_id} for workspace {workspace_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to terminate sandbox {sandbox_id}: {e}")
        set_workspace_kernel_id(workspace_id, None)
        return False


async def get_sandbox(sandbox_id: str) -> modal.Sandbox:
    """Get a sandbox by ID."""
    return await modal.Sandbox.from_id.aio(sandbox_id)
