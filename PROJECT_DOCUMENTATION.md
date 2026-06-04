# Supernova Project Documentation

This document summarizes the implemented scope of the current project state in this workspace.

## 1. Overview: Main Features Implemented

### End-user workflow

- ZIP-based DICOM upload flow from the browser.
- Segmentation quality selection (`fast` or `full`).
- Volume export quality selection (`standard` or `high`).
- Client-side memory preflight warning before upload.
- Real-time processing screen with live progress, stage updates, and elapsed time.
- Recent upload catalog so users can resume in-flight jobs or reopen completed studies.
- Single-page viewer flow with dedicated upload, processing, and viewer routes.

### Imaging and segmentation support

- CT segmentation support through TotalSegmentator.
- MRI segmentation support through MRSegmentator for anatomical torso studies.
- MRI upload profiling and rejection rules for unsupported studies, including:
  - dynamic or derived MRI sequences
  - non-torso MRI studies
  - limited-field-of-view MRI studies with low z coverage or low slice count
- Shared post-processing pipeline after segmentation for mesh export and volume preparation.

### 3D and slice viewer capabilities

- Interactive 3D organ viewer built on VTK.js.
- Per-organ visibility toggles.
- Category-level show/hide controls.
- Organ search and grouped anatomy browser.
- Visibility presets for filtered anatomy sets.
- Three-plane clipping controls in model mode.
- Hover-driven organ focus with delayed dwell behavior.
- Pinned hover details tooltip with anatomy descriptions.
- Orthogonal slice viewing with axial, coronal, and sagittal panes.
- Slice overlays using the exported segmentation volume.
- Slice interaction modes for navigation, distance measurement, and intensity probing.
- Anatomy label overlays on slice panes.
- Study metadata side panel for patient and scan details.
- Collapsible tool, organ, and metadata panels with dock buttons to reopen them.

### Delivery and deployment work already in place

- Dockerized full-stack build that serves the built frontend from the backend container.
- Local Docker Compose path for CPU-oriented development.
- EC2-focused Docker Compose path for GPU-backed deployment.
- Health check endpoint and container health check wiring.
- Persistent output directory support via `SUPERNOVA_OUTPUT_DIR`.
- Recent upload persistence through a JSON catalog stored beside generated outputs.
- Backend and frontend automated test suites covering the core pipeline and viewer logic.

## 2. Technical Overview

### Frontend architecture

The frontend is a React + TypeScript single-page app with three route-level pages:

- `/` -> `UploadPage`
- `/processing/:jobId` -> `LoadingPage`
- `/viewer/:jobId` -> `ViewerPage`

Page responsibilities:

- `UploadPage`
  - collects ZIP uploads
  - selects segmentation and volume quality
  - checks backend memory guidance
  - loads recent uploads from the backend
  - redirects users into processing or viewer flows
- `LoadingPage`
  - subscribes to a job-specific WebSocket
  - renders progress ring, status text, and elapsed time
  - navigates to the viewer when processing completes
- `ViewerPage`
  - fetches job results and volume metadata
  - coordinates viewer state, hover state, panel visibility, visibility presets, slice tools, and clipping
  - composes the viewer shell from smaller components

Main viewer components:

- `OrganPanel` for anatomy search, grouped categories, visibility toggles, and hover entry points
- `VTKRenderer` for STL mesh loading, 3D rendering, clipping planes, and mesh picking
- `SliceViewport` for orthogonal slice rendering, overlay blending, cursor movement, measurements, and probes
- `ViewerToolPanel` for visibility presets, slice interaction tools, and anatomy labels
- `StudyMetadataPanel` for scan metadata display
- `ViewerControls` for switching between model and slice modes plus clipping controls

Frontend data flow:

```text
UploadPage
  -> GET /api/memory-check
  -> GET /api/recent-uploads
  -> POST /api/upload

LoadingPage
  -> WS /api/progress/{job_id}

ViewerPage
  -> GET /api/results/{job_id}
  -> GET /api/meshes/{job_id}/{filename}
  -> GET /api/volume/{job_id}/{filename}
```

### Backend architecture

The backend is a FastAPI application that owns upload handling, job orchestration, segmentation routing, mesh generation, volume export, recent-upload persistence, and static frontend serving in production.

Core backend characteristics:

- FastAPI app entry in `backend/app/main.py`
- Route definitions in `backend/app/routes.py`
- Processing pipeline and job state management in `backend/app/processing.py`
- Mesh conversion in `backend/app/mesh_generation.py`
- Volume export and DICOM/NIfTI handling in `backend/app/volume_export.py`
- WebSocket connection management in `backend/app/websocket.py`
- Pydantic data models and enums in `backend/app/models.py`

Current pipeline behavior:

1. Accept upload and create a job record.
2. Save the uploaded ZIP into the job output directory.
3. Validate that the ZIP contains DICOM content.
4. Inspect study metadata to determine modality and MRI support eligibility.
5. Route CT studies to TotalSegmentator or MRI torso studies to MRSegmentator.
6. Generate 3D meshes for segmented structures.
7. Export volume assets for slice viewing.
8. Persist result metadata and refresh the recent-upload catalog.
9. Broadcast progress updates through the WebSocket manager.

Operational constraints currently implemented:

- In-memory job store for active jobs.
- Single pipeline concurrency lock because segmentation is resource-heavy.
- Output-path indirection through `SUPERNOVA_OUTPUT_DIR`.
- Optional static frontend serving through `SUPERNOVA_STATIC_DIR`.

### API endpoints

| Method | Path                              | Purpose                                                      |
| ------ | --------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/health`                     | Health check for local use, containers, and load balancers   |
| POST   | `/api/upload`                     | Upload a DICOM ZIP and start background processing           |
| GET    | `/api/results/{job_id}`           | Return completed job results or `202` while still processing |
| GET    | `/api/recent-uploads`             | Return the latest cached uploads                             |
| GET    | `/api/status/{job_id}`            | Return job status, progress, elapsed time, and error state   |
| GET    | `/api/memory-check`               | Return memory guidance for segmentation quality              |
| GET    | `/api/meshes/{job_id}/{filename}` | Serve generated mesh assets                                  |
| GET    | `/api/volume/{job_id}/{filename}` | Serve exported raw volume assets and metadata files          |
| WS     | `/api/progress/{job_id}`          | Stream progress updates for a processing job                 |

### Tech stack

Frontend:

- React 19
- TypeScript 6
- React Router 7
- Vite 6
- VTK.js
- Tailwind CSS 4 via the Vite Tailwind plugin
- Vitest + Testing Library + happy-dom
- ESLint 9 with TypeScript and React Hooks rules

Backend:

- Python 3.11
- FastAPI
- Uvicorn
- Pydantic v2
- NumPy and SciPy
- pydicom
- nibabel
- scikit-image
- trimesh
- fast-simplification
- psutil
- websockets
- python-multipart

Segmentation/runtime tooling:

- TotalSegmentator for CT segmentation
- MRSegmentator for MRI torso segmentation
- Isolated Python environments for the two segmentation runtimes because their published dependency sets conflict

Delivery and infrastructure:

- Docker multi-stage builds
- Docker Compose for local and EC2 deployment paths
- Static frontend delivery from the FastAPI container in production mode

## 3. Commands

### Run the full stack with Docker

```powershell
docker compose up --build
```

### Run the EC2/GPU-oriented compose file

```powershell
docker compose -f docker-compose.ec2.yml up --build
```

### Backend local setup

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
pip install pytest pytest-asyncio httpx
uvicorn app.main:app --reload --port 8000
```

### Optional local model runtime setup outside Docker

```powershell
# TotalSegmentator runtime
python -m venv .venvs/totalsegmentator
.\.venvs\totalsegmentator\Scripts\pip install -r requirements-totalsegmentator.txt
set SUPERNOVA_TOTALSEGMENTATOR_COMMAND=%CD%\.venvs\totalsegmentator\Scripts\TotalSegmentator.exe

# MRSegmentator runtime
python -m venv .venvs/mrsegmentator
.\.venvs\mrsegmentator\Scripts\pip install -r requirements-mrsegmentator.txt
set SUPERNOVA_MRSEGMENTATOR_COMMAND=%CD%\.venvs\mrsegmentator\Scripts\mrsegmentator.exe
```

### Frontend local setup

```powershell
cd frontend
npm install
npm run dev
```

### Backend tests

```powershell
cd backend
python -m pytest
```

### Frontend tests

```powershell
cd frontend
npm test
```

### Frontend lint and production build

```powershell
cd frontend
npm run lint
npm run build
```

### Focused frontend viewer validation

```powershell
cd frontend
npm test -- --run src/__tests__/ViewerPage.test.tsx src/__tests__/OrganPanel.test.tsx src/__tests__/SliceViewport.test.tsx src/__tests__/sliceUtils.test.ts src/__tests__/viewerTools.test.ts
```

## 5. Misc. Information

- The backend currently keeps active job state in memory, which fits single-instance deployment best.
- Processing is intentionally serialized behind a single async lock because segmentation workloads are heavy.
- Completed outputs and the recent-upload catalog are written under `SUPERNOVA_OUTPUT_DIR`.
- The recent upload list is currently stored as a JSON file and limited to the latest five entries.
- The Docker image serves the compiled frontend from FastAPI when `SUPERNOVA_STATIC_DIR` is set.
- The default local Docker path uses CPU-oriented PyTorch wheels.
- The EC2 compose file switches to CUDA 12.1 wheels and requests all visible NVIDIA GPUs.
- The EC2 deployment path defaults to host port `80` and host data directory `/srv/supernova-data`.
- MRI support is intentionally narrow: anatomical torso studies are accepted, while unsupported sequence types and low-coverage studies are rejected before segmentation.
- The project includes separate requirement files for the shared backend, TotalSegmentator runtime, and MRSegmentator runtime.
- Automated tests currently exist for backend route/model/processing helpers and for frontend page, viewer, and utility behavior.
