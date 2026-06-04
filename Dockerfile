# Stage 1: Build frontend
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend + serve built frontend
FROM python:3.11-slim

ARG SUPERNOVA_TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
ARG SUPERNOVA_TORCH_VERSION=2.3.1
ARG SUPERNOVA_TORCHVISION_VERSION=0.18.1

# System deps for scikit-image, trimesh, PyTorch (CPU), etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./requirements.txt
COPY backend/requirements-totalsegmentator.txt ./requirements-totalsegmentator.txt
COPY backend/requirements-mrsegmentator.txt ./requirements-mrsegmentator.txt
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m venv /opt/venvs/totalsegmentator \
    && /opt/venvs/totalsegmentator/bin/pip install --no-cache-dir --index-url ${SUPERNOVA_TORCH_INDEX_URL} torch==${SUPERNOVA_TORCH_VERSION} torchvision==${SUPERNOVA_TORCHVISION_VERSION} \
    && /opt/venvs/totalsegmentator/bin/pip install --no-cache-dir -r requirements-totalsegmentator.txt
RUN python -m venv /opt/venvs/mrsegmentator \
    && /opt/venvs/mrsegmentator/bin/pip install --no-cache-dir --index-url ${SUPERNOVA_TORCH_INDEX_URL} torch==${SUPERNOVA_TORCH_VERSION} torchvision==${SUPERNOVA_TORCHVISION_VERSION} \
    && /opt/venvs/mrsegmentator/bin/pip install --no-cache-dir -r requirements-mrsegmentator.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend into a static directory
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Add static file serving to the backend
ENV SUPERNOVA_STATIC_DIR=/app/frontend/dist
ENV SUPERNOVA_OUTPUT_DIR=/data/supernova
ENV SUPERNOVA_TOTALSEGMENTATOR_COMMAND=/opt/venvs/totalsegmentator/bin/TotalSegmentator
ENV SUPERNOVA_MRSEGMENTATOR_COMMAND=/opt/venvs/mrsegmentator/bin/mrsegmentator
ENV PATH="/opt/venvs/totalsegmentator/bin:/opt/venvs/mrsegmentator/bin:${PATH}"

RUN mkdir -p /data/supernova

WORKDIR /app/backend

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
