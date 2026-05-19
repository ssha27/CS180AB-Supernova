"""FastAPI application entry point."""
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.routes import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger("supernova").info("Supernova server starting")
    yield
    logging.getLogger("supernova").info("Supernova server shutting down")


app = FastAPI(
    title="Supernova CT Viewer",
    description="Web-based CT scan 3D segmentation viewer",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Serve built frontend in production (set SUPERNOVA_STATIC_DIR env var)
_static_dir = os.environ.get("SUPERNOVA_STATIC_DIR")
if _static_dir and Path(_static_dir).is_dir():
    _static_path = Path(_static_dir)

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA — return the file if it exists, otherwise index.html."""
        file = _static_path / full_path
        if full_path and file.is_file():
            return FileResponse(file)
        return FileResponse(_static_path / "index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
