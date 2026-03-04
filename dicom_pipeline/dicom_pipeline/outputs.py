"""
Output writers:
- image.npy (tensor)
- preview.png
- meta.json
- deid_report.json
"""

import json
from pathlib import Path
from typing import Dict

import numpy as np
import matplotlib.pyplot as plt


def save_series_outputs(out_dir: Path, tensor: np.ndarray, meta: Dict, deid_report: Dict) -> None:
    """
    tensor expected shape: (1, D, H, W) float32 in [0,1]
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    np.save(out_dir / "image.npy", tensor)

    # preview is the mid slice
    d = tensor.shape[1]
    mid = d // 2
    preview = tensor[0, mid]

    plt.figure()
    plt.imshow(preview, cmap="gray")
    plt.axis("off")
    plt.tight_layout(pad=0)
    plt.savefig(out_dir / "preview.png", dpi=200, bbox_inches="tight", pad_inches=0)
    plt.close()

    # Add basic tensor stats (safe)
    meta2 = dict(meta)
    meta2.update({
        "tensor_shape": list(tensor.shape),
        "tensor_dtype": str(tensor.dtype),
        "tensor_min": float(np.min(tensor)),
        "tensor_max": float(np.max(tensor)),
        "tensor_mean": float(np.mean(tensor)),
    })

    (out_dir / "meta.json").write_text(json.dumps(meta2, indent=2))
    (out_dir / "deid_report.json").write_text(json.dumps(deid_report, indent=2))