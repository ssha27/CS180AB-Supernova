"""
Central configuration for normalization + behavior
"""

from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class CTNormalization:
    # Simple baseline for CT in HU
    clamp_min_hu: float = -1000.0
    clamp_max_hu: float = 1000.0


@dataclass(frozen=True)
class GenericNormalization:
    # Percentile clipping for non-CT modalities
    p_low: float = 1.0
    p_high: float = 99.0


@dataclass(frozen=True)
class PipelineConfig:
    # Output tensor convention is always channels-first:
    # (1, D, H, W)
    ct_norm: CTNormalization = CTNormalization()
    generic_norm: GenericNormalization = GenericNormalization()

    # If the folder contains multiple series, default behavior is:
    # - process only the largest series (most slices)
    # (caller can override with --all_series)
    process_largest_series_only: bool = True