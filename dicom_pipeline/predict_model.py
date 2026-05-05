"""
Run prediction w placeholder data.
"""

import argparse
import json
from pathlib import Path

from dicom_pipeline.model import load_checkpoint, load_manifest, predict_probability


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="Path to saved .pt checkpoint")
    ap.add_argument("--image", default=None, help="One image.npy to predict")
    ap.add_argument("--data", default=None, help="Ingest output folder; predicts all series in manifest")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    if not args.image and not args.data:
        raise ValueError("Provide --image or --data")

    model, ckpt = load_checkpoint(Path(args.model), device=args.device)
    target_size = int(ckpt.get("target_size", 224))

    image_paths = []
    if args.image:
        image_paths.append(Path(args.image))
    if args.data:
        image_paths.extend([r.image_path for r in load_manifest(Path(args.data))])

    predictions = []
    for image_path in image_paths:
        prob = predict_probability(model, image_path, target_size=target_size, device=args.device)
        predictions.append(
            {
                "series_id": image_path.parent.name,
                "image_path": str(image_path),
                "placeholder_probability_label_1": prob,
                "warning": "This placeholder model is not clinically valid.",
            }
        )

    print(json.dumps(predictions, indent=2))


if __name__ == "__main__":
    main()
