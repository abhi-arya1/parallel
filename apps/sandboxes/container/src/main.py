"""
Sandbox Server for Parallel

Manages persistent Modal Sandboxes (kernels) for notebook-style code execution.
Each workspace gets its own kernel that maintains state across cell executions.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .utils.config import CONVEX_URL
from .utils.logging import logger
from .services.convex import get_convex_client
from .routes import health, kernel, execute


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info(f"Starting Sandbox Server with CONVEX_URL: {CONVEX_URL}")
    if CONVEX_URL:
        get_convex_client()
    yield
    logger.info("Shutting down Sandbox Server")


app = FastAPI(
    title="Parallel Sandbox Server",
    description="Persistent notebook kernels on Modal Sandboxes",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)

# Register routes
app.include_router(health.router)
app.include_router(kernel.router)
app.include_router(execute.router)


@app.get("/")
async def root():
    """Root endpoint."""
    return {"service": "Parallel Sandbox Server", "status": "running"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
