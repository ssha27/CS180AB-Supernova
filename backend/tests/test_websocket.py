"""Tests for WebSocket manager."""
import pytest
from unittest.mock import AsyncMock, MagicMock
from app.websocket import ConnectionManager
from app.models import ProgressUpdate, JobStatus


@pytest.fixture
def mgr():
    return ConnectionManager()


@pytest.fixture
def mock_ws():
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.send_text = AsyncMock()
    return ws


class TestConnectionManager:
    async def test_connect_accepts_websocket(self, mgr, mock_ws):
        await mgr.connect("job1", mock_ws)
        mock_ws.accept.assert_awaited_once()

    async def test_connect_tracks_connection(self, mgr, mock_ws):
        await mgr.connect("job1", mock_ws)
        assert mgr.has_connections("job1")
        assert mgr.get_connection_count("job1") == 1

    async def test_disconnect_removes_connection(self, mgr, mock_ws):
        await mgr.connect("job1", mock_ws)
        mgr.disconnect("job1", mock_ws)
        assert not mgr.has_connections("job1")
        assert mgr.get_connection_count("job1") == 0

    async def test_multiple_connections_same_job(self, mgr):
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        await mgr.connect("job1", ws1)
        await mgr.connect("job1", ws2)
        assert mgr.get_connection_count("job1") == 2

    async def test_send_progress_to_all_clients(self, mgr):
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        await mgr.connect("job1", ws1)
        await mgr.connect("job1", ws2)

        update = ProgressUpdate(
            job_id="job1", status=JobStatus.SEGMENTING, progress=50,
            message="Processing...",
        )
        await mgr.send_progress("job1", update)

        ws1.send_text.assert_awaited_once()
        ws2.send_text.assert_awaited_once()

    async def test_send_progress_no_connections(self, mgr):
        update = ProgressUpdate(
            job_id="job1", status=JobStatus.PENDING, progress=0,
        )
        # Should not raise
        await mgr.send_progress("job1", update)

    async def test_dead_connections_removed(self, mgr):
        ws_alive = AsyncMock()
        ws_dead = AsyncMock()
        ws_dead.send_text.side_effect = Exception("Connection closed")

        await mgr.connect("job1", ws_alive)
        await mgr.connect("job1", ws_dead)

        update = ProgressUpdate(
            job_id="job1", status=JobStatus.MESHING, progress=80,
        )
        await mgr.send_progress("job1", update)

        assert mgr.get_connection_count("job1") == 1

    async def test_has_connections_false_for_unknown_job(self, mgr):
        assert not mgr.has_connections("unknown")

    async def test_get_connection_count_zero_for_unknown(self, mgr):
        assert mgr.get_connection_count("unknown") == 0
