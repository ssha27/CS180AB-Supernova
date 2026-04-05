# CS180AB-Supernova

A DICOM viewer with a React frontend, Node.js API gateway, and Python DICOM processing service, backed by PostgreSQL and MongoDB.

## Prerequisites

- [Docker](https://www.docker.com/) (for MongoDB and PostgreSQL)
- [Node.js](https://nodejs.org/) (v18+)
- [Python](https://www.python.org/) (3.10+)

## Getting Started

### 1. Start the databases

```bash
docker compose up -d
```

This starts MongoDB (port 27017) and PostgreSQL (port 5432).

### 2. Start the backend API gateway

```bash
cd backend
npm install
npm run dev
```

### 3. Start the DICOM processing service

```bash
cd backend/dicom-service
pip install -e .
uvicorn app.main:app --reload
```

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at http://localhost:5173.
