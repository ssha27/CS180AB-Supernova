from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import router

app = FastAPI(
    title="Supernova DICOM Service",
    version="0.1.0",
    description="DICOM processing microservice — parses, anonymizes, and converts DICOM to 3D",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "supernova-dicom-service"}
