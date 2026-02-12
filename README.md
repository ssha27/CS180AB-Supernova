# Supernova

Web-based DICOM 3D visualization platform for medical imaging. Upload DICOM files and interact with 3D models of anatomical structures.

## Architecture

```
frontend/          → React 19 + Vite 6 + vtk.js (3D viewer)
backend/           → Node.js Express API gateway
backend/dicom-service/ → Python FastAPI DICOM processing microservice
```

## Quick Start

### Prerequisites
- Node.js 20+
- Python 3.10+
- Docker & Docker Compose (optional)

### Development (without Docker)

**1. Frontend**
```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

**2. API Gateway**
```bash
cd backend
npm install
npm run dev          # http://localhost:4000
```

**3. DICOM Service**
```bash
cd backend/dicom-service
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 5000
```

### Development (with Docker)
```bash
cp .env.example .env
docker-compose up --build
```

## Running Tests

```bash
# Frontend
cd frontend && npm test

# API Gateway
cd backend && npm test

# DICOM Service
cd backend/dicom-service && pytest
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 6, vtk.js, Zustand |
| API Gateway | Node.js, Express |
| DICOM Processing | Python, FastAPI, pydicom, VTK, NumPy |
| 3D Rendering | Volume raycasting + Marching Cubes surface extraction |
| Containerization | Docker, Docker Compose |