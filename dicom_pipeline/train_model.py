"""
Train the placeholder oral-cancer classifier.
"""

import argparse
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from dicom_pipeline.model import (
    CTSeriesDataset,
    SmallSliceCNN,
    attach_labels,
    load_manifest,
    save_checkpoint,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="out", help="Ingest output folder containing manifest.json or series_*/image.npy")
    ap.add_argument("--labels", default=None, help="Optional CSV with series_id,label or image_path,label")
    ap.add_argument("--output", default="models/oral_ct_cnn.pt", help="Where to save model checkpoint")
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--batch_size", type=int, default=2)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--target_size", type=int, default=224)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--smoke", action="store_true", help="Allow fake deterministic labels when labels are missing")
    args = ap.parse_args()

    data_root = Path(args.data)
    labels_csv = Path(args.labels) if args.labels else None

    records = load_manifest(data_root)
    records = attach_labels(records, labels_csv)
    if not records:
        raise FileNotFoundError(f"No ingested series found under {data_root}. Run run_ingest.py first.")

    missing_labels = [r.series_id for r in records if r.label is None]
    smoke = bool(args.smoke or labels_csv is None)
    if missing_labels and not smoke:
        preview = ", ".join(missing_labels[:5])
        raise ValueError(f"Missing labels for {len(missing_labels)} series: {preview}. Add --smoke to demo without labels.")

    dataset = CTSeriesDataset(records, target_size=args.target_size, smoke=smoke)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True)

    device = torch.device(args.device)
    model = SmallSliceCNN().to(device)
    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    print(f"Training on {len(dataset)} series | smoke={smoke} | device={device}")
    if smoke:
        print("WARNING: using fake labels. This only validates the code path, not diagnosis quality.")

    model.train()
    for epoch in range(args.epochs):
        total_loss = 0.0
        for x, y, series_ids in loader:
            x = x.to(device)
            y = y.to(device)

            logits = model(x)
            loss = criterion(logits, y)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            total_loss += loss.item() * x.size(0)

        avg_loss = total_loss / len(dataset)
        print(f"epoch={epoch + 1}/{args.epochs} loss={avg_loss:.4f}")

    save_checkpoint(model, Path(args.output), target_size=args.target_size, smoke=smoke)
    print(f"Saved checkpoint: {args.output}")


if __name__ == "__main__":
    main()
