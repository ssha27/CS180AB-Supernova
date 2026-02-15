FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./

RUN pip install --no-cache-dir torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir .

RUN python -c "from totalsegmentator.python_api import totalsegmentator; print('TotalSegmentator installed')" || true

COPY app ./app

EXPOSE 5000

ENV TOTALSEG_DEVICE=auto

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000"]
