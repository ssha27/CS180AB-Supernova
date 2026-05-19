"""Tests for memory check module."""
import pytest
from unittest.mock import patch
from app.memory_check import check_memory, MEMORY_REQUIREMENTS_GB


class TestMemoryRequirements:
    def test_requirements_has_fast_and_full(self):
        assert "fast" in MEMORY_REQUIREMENTS_GB
        assert "full" in MEMORY_REQUIREMENTS_GB

    def test_full_requires_more_than_fast(self):
        assert MEMORY_REQUIREMENTS_GB["full"] > MEMORY_REQUIREMENTS_GB["fast"]


class TestCheckMemory:
    @patch("app.memory_check.psutil.virtual_memory")
    def test_sufficient_memory_fast(self, mock_vmem):
        mock_vmem.return_value.available = 16 * 1024**3  # 16 GB
        result = check_memory("fast")
        assert result.sufficient is True
        assert result.available_gb == pytest.approx(16.0, abs=0.1)

    @patch("app.memory_check.psutil.virtual_memory")
    def test_insufficient_memory_fast(self, mock_vmem):
        mock_vmem.return_value.available = 4 * 1024**3  # 4 GB
        result = check_memory("fast")
        assert result.sufficient is False
        assert "insufficient" in result.message.lower() or "required" in result.message.lower()

    @patch("app.memory_check.psutil.virtual_memory")
    def test_sufficient_memory_full(self, mock_vmem):
        mock_vmem.return_value.available = 40 * 1024**3  # 40 GB
        result = check_memory("full")
        assert result.sufficient is True

    @patch("app.memory_check.psutil.virtual_memory")
    def test_insufficient_memory_full(self, mock_vmem):
        mock_vmem.return_value.available = 16 * 1024**3  # 16 GB
        result = check_memory("full")
        assert result.sufficient is False
        assert result.required_gb == MEMORY_REQUIREMENTS_GB["full"]

    @patch("app.memory_check.psutil.virtual_memory")
    def test_returns_memory_warning_model(self, mock_vmem):
        mock_vmem.return_value.available = 20 * 1024**3
        result = check_memory("fast")
        assert hasattr(result, "available_gb")
        assert hasattr(result, "required_gb")
        assert hasattr(result, "sufficient")
        assert hasattr(result, "message")

    def test_invalid_quality_defaults_to_fast(self):
        result = check_memory("nonsense")
        assert result.required_gb == MEMORY_REQUIREMENTS_GB["fast"]
