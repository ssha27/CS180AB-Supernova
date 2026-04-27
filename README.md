# Supernova CT Viewer

Web-based CT scan 3D segmentation viewer. Upload DICOM CT scans, run AI-powered organ segmentation via [TotalSegmentator](https://github.com/wasserth/TotalSegmentator), and explore the results in an interactive 3D viewer — all in the browser.

## Features

- **Upload** — Drag-and-drop a ZIP of DICOM files with quality presets (Fast / Full segmentation, Standard / High volume)
- **Live progress** — WebSocket-driven progress ring with elapsed time and stage updates
- **3D Viewer** — VTK.js-powered organ rendering with:
  - Rotate, pan, zoom
  - Per-organ show/hide with color-coded organ panel
  - Category-level toggling and search
  - Axial, coronal, and sagittal clipping planes
  - 3D Slicer–matching organ colors

## Quick Start (Docker)

```bash
docker compose up --build
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

## Local Development

### Prerequisites

- Python 3.11+
- Node.js 20+

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
