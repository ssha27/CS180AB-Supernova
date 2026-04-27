"""WebSocket connection manager for broadcasting progress updates."""
import asyncio
import json
from fastapi import WebSocket
from app.models import ProgressUpdate


class ConnectionManager:
    """Manages WebSocket connections per job_id for progress broadcasting."""

    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, job_id: str, websocket: WebSocket):
        await websocket.accept()
        if job_id not in self._connections:
            self._connections[job_id] = []
        self._connections[job_id].append(websocket)

    def disconnect(self, job_id: str, websocket: WebSocket):
        if job_id in self._connections:
            self._connections[job_id] = [
                ws for ws in self._connections[job_id] if ws != websocket
            ]
            if not self._connections[job_id]:
                del self._connections[job_id]

    async def send_progress(self, job_id: str, update: ProgressUpdate):
        """Send a progress update to all WebSocket clients watching a job."""
        if job_id not in self._connections:
            return
        message = update.model_dump_json()
        dead = []
        for ws in self._connections[job_id]:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(job_id, ws)

    def get_connection_count(self, job_id: str) -> int:
        return len(self._connections.get(job_id, []))

    def has_connections(self, job_id: str) -> bool:
        return job_id in self._connections and len(self._connections[job_id]) > 0


# Singleton instance
manager = ConnectionManager()
