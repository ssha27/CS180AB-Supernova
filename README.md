# Supernova Medical Viewer

Web-based CT and MRI 3D segmentation viewer. Upload DICOM studies, run AI-powered anatomy segmentation, and explore the results in an interactive 3D viewer — all in the browser.

## Features

- **Upload** — Drag-and-drop a ZIP of DICOM files with quality presets (Fast / Full segmentation, Standard / High volume)
- **Live progress** — WebSocket-driven progress ring with elapsed time and stage updates
- **3D Viewer** — VTK.js-powered organ rendering with:
  - Rotate, pan, zoom
  - Per-organ show/hide with color-coded organ panel
  - Category-level toggling and search
  - Axial, coronal, and sagittal clipping planes
  - 3D Slicer–matching organ colors
- **MRI support** — Anatomical torso MRI studies with sufficient coverage (abdomen, pelvis, thorax) route through [MRSegmentator](https://github.com/hhaentze/MRSegmentator), while CT studies continue to use [TotalSegmentator](https://github.com/wasserth/TotalSegmentator). Dynamic, derived, and limited-field-of-view MRI series are rejected before segmentation.
- **Slice mode** — MRI and CT studies both expose aligned raw-volume slice panes with segmentation overlays, measurements, and modality-aware metadata

## Quick Start (Docker)

```bash
docker compose up --build
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

The default Docker build uses CPU PyTorch wheels so it can build on a normal local machine without pulling the full CUDA runtime stack.

For an EC2-oriented deployment path, use [AWS_EC2_CHECKLIST.md](AWS_EC2_CHECKLIST.md) together with [docker-compose.ec2.yml](docker-compose.ec2.yml).
That compose file switches the build to CUDA 12.1 wheels and requests all visible GPUs at runtime.

## Local Development

### Prerequisites

- Python 3.11
- Node.js 20+

MRI support depends on MRSegmentator, which currently targets Python versions below 3.13. If you are running locally outside Docker, use Python 3.11 for the backend environment.

Docker installs TotalSegmentator and MRSegmentator in separate Python environments because their published dependencies currently conflict on different `nnunetv2` versions.
The local compose file builds those environments with CPU PyTorch by default, while the EC2 compose file swaps in CUDA wheels for GPU hosts.

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux
pip install -r requirements.txt
pip install pytest pytest-asyncio httpx  # dev deps
uvicorn app.main:app --reload --port 8000
```

If you want segmentation to run outside Docker, install each model runtime in its own environment and point the backend at the executables:

```bash
# TotalSegmentator runtime
python -m venv .venvs/totalsegmentator
.\.venvs\totalsegmentator\Scripts\pip install -r requirements-totalsegmentator.txt
set SUPERNOVA_TOTALSEGMENTATOR_COMMAND=%CD%\.venvs\totalsegmentator\Scripts\TotalSegmentator.exe

# MRSegmentator runtime
python -m venv .venvs\mrsegmentator
.\.venvs\mrsegmentator\Scripts\pip install -r requirements-mrsegmentator.txt
set SUPERNOVA_MRSEGMENTATOR_COMMAND=%CD%\.venvs\mrsegmentator\Scripts\mrsegmentator.exe
```

On macOS or Linux, use the matching `bin/` paths instead of `Scripts/` and export the two environment variables before starting Uvicorn.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server runs at `http://localhost:5173` and proxies `/api` requests to the backend.

### Tests

```bash
# Backend (92 tests)
cd backend
python -m pytest

# Frontend (24 tests)
cd frontend
npm test
```

## Architecture

```
Upload Page  ──▶  POST /api/upload  ──▶  Background pipeline
                                            │
Loading Page ◀── WS /api/progress/{id} ◀───┘
     │
     ▼
Viewer Page  ──▶  GET /api/results/{id}
                  GET /api/meshes/{id}/{file}.glb
                  GET /api/volume/{id}/volume.raw
```

**Backend:** FastAPI (Python) — DICOM validation → TotalSegmentator → marching cubes mesh generation → GLB export → volume downsampling.

CT studies use TotalSegmentator. Supported anatomical torso MRI studies are converted to NIfTI locally and then segmented with MRSegmentator before entering the same mesh and slice export pipeline. Dynamic, derived, and limited-field-of-view MRI series are rejected because they do not produce reliable multi-organ segmentations.

**Frontend:** React + TypeScript + VTK.js — SPA with upload, loading, and 3D viewer pages.

## Project Structure

```
├── Dockerfile              # Multi-stage build
├── docker-compose.yml
├── backend/
│   ├── app/
│   │   ├── main.py         # FastAPI entry
│   │   ├── routes.py       # API endpoints
│   │   ├── processing.py   # Pipeline orchestration
│   │   ├── mesh_generation.py
│   │   ├── volume_export.py
│   │   ├── color_map.py    # 117 organ colors
│   │   ├── memory_check.py
│   │   ├── websocket.py
│   │   └── models.py       # Pydantic schemas
│   ├── tests/
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── pages/           # Upload, Loading, Viewer
    │   ├── components/      # VTKRenderer, OrganPanel, ClippingControls
    │   ├── hooks/
    │   └── utils/
    └── package.json
```
