from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch.utils.data import Dataset
except ImportError as exc:
    raise ImportError(
        "The model module requires PyTorch. Install requirements with: "
        "pip install -r requirements.txt"
    ) from exc


@dataclass
class SeriesRecord:
    series_id: str
    image_path: Path
    meta_path: Path | None = None
    preview_path: Path | None = None
    label: int | None = None


class SmallSliceCNN(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, 8, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(8, 16, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d((1, 1)),
            nn.Flatten(),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class CTSeriesDataset(Dataset):
    def __init__(
        self,
        records: Sequence[SeriesRecord],
        target_size: int = 224,
        smoke: bool = True,
    ) -> None:
        if not records:
            raise ValueError("CTSeriesDataset received no records.")
        self.records = list(records)
        self.target_size = int(target_size)
        self.smoke = bool(smoke)

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor, str]:
        rec = self.records[idx]
        vol = np.load(rec.image_path).astype(np.float32)  # (1, D, H, W)
        if vol.ndim != 4 or vol.shape[0] != 1:
            raise ValueError(f"Expected image.npy shape (1,D,H,W), got {vol.shape}: {rec.image_path}")

        middle = vol.shape[1] // 2
        x = torch.from_numpy(vol[:, middle, :, :])
        x = x.unsqueeze(0)
        x = F.interpolate(
            x,
            size=(self.target_size, self.target_size),
            mode="bilinear",
            align_corners=False,
        ).squeeze(0)

        label = rec.label
        if label is None:
            if not self.smoke:
                raise ValueError(f"Missing real label for {rec.series_id}. Use --smoke or provide labels.csv.")
            label = deterministic_smoke_label(rec.series_id)

        y = torch.tensor([float(label)], dtype=torch.float32)
        return x, y, rec.series_id


def deterministic_smoke_label(series_id: str) -> float:
    digest = hashlib.sha256(series_id.encode("utf-8")).hexdigest()
    return float(int(digest[:2], 16) % 2)


def load_manifest(data_root: Path) -> list[SeriesRecord]:
    data_root = Path(data_root)
    manifest_path = data_root / "manifest.json"

    if not manifest_path.exists():
        raise FileNotFoundError(f"Could not find manifest.json at {manifest_path}")

    payload = json.loads(manifest_path.read_text())

    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("series", [])
    else:
        raise ValueError("manifest.json must contain either a list or a dictionary with a 'series' field")

    records = []

    for row in rows:
        records.append(
            SeriesRecord(
                series_id=row["series_id"],
                image_path=Path(row["image_path"]),
                meta_path=Path(row["meta_path"]) if row.get("meta_path") else None,
                preview_path=Path(row["preview_path"]) if row.get("preview_path") else None,
                label=row.get("label"),
            )
        )

    return records

def discover_ingested_series(output_root: Path) -> List[SeriesRecord]:
    root = Path(output_root)
    records: List[SeriesRecord] = []
    for image_path in sorted(root.glob("series_*/image.npy")):
        series_id = image_path.parent.name
        meta_path = image_path.parent / "meta.json"
        records.append(
            SeriesRecord(
                series_id=series_id,
                image_path=image_path.resolve(),
                meta_path=meta_path.resolve() if meta_path.exists() else None,
            )
        )
    return records


def load_labels_csv(labels_csv: Path) -> Dict[str, float]:
    labels: Dict[str, float] = {}
    with Path(labels_csv).open(newline="") as f:
        reader = csv.DictReader(f)
        required = set(reader.fieldnames or [])
        if "label" not in required or not ({"series_id", "image_path"} & required):
            raise ValueError("labels CSV must contain label plus series_id or image_path columns")

        for row in reader:
            key = row.get("series_id") or row.get("image_path")
            if not key:
                continue
            labels[str(key)] = float(row["label"])
    return labels


def attach_labels(records: Iterable[SeriesRecord], labels_csv: Optional[Path]) -> List[SeriesRecord]:
    records = list(records)
    if labels_csv is None:
        return records

    labels = load_labels_csv(labels_csv)
    labeled: List[SeriesRecord] = []
    for rec in records:
        label = labels.get(rec.series_id)
        if label is None:
            label = labels.get(str(rec.image_path))
        if label is None:
            label = labels.get(str(rec.image_path.resolve()))
        labeled.append(
            SeriesRecord(
                series_id=rec.series_id,
                image_path=rec.image_path,
                meta_path=rec.meta_path,
                label=label,
            )
        )
    return labeled


def predict_probability(model: nn.Module, image_path: Path, target_size: int = 224, device: str = "cpu") -> float:
    rec = SeriesRecord(series_id=Path(image_path).parent.name, image_path=Path(image_path))
    ds = CTSeriesDataset([rec], target_size=target_size, smoke=True)
    x, _, _ = ds[0]
    model.eval()
    with torch.no_grad():
        logits = model(x.unsqueeze(0).to(device))
        prob = torch.sigmoid(logits).item()
    return float(prob)


def save_checkpoint(model: nn.Module, output_path: Path, target_size: int, smoke: bool) -> None:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "model_class": "SmallSliceCNN",
            "target_size": int(target_size),
            "smoke_trained": bool(smoke),
            "warning": "Smoke-trained model is not clinically valid and must not be used for diagnosis.",
        },
        output_path,
    )


def load_checkpoint(checkpoint_path: Path, device: str = "cpu") -> Tuple[nn.Module, Dict]:
    ckpt = torch.load(Path(checkpoint_path), map_location=device)
    model = SmallSliceCNN().to(device)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    return model, ckpt
