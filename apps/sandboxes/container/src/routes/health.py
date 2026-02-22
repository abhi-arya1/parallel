"""
Health check endpoint.
"""

from fastapi import APIRouter

from ..utils.config import CONVEX_URL

router = APIRouter()


@router.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "convex_configured": CONVEX_URL is not None}
