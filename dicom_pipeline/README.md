How to run smoke-screen data for proof-of-concept:

- cd dicom_pipeline

Create venv
- python -m venv venv

Install dependencies
- pip install -r requirements.txt

Create filler data:
  @'
  from pathlib import Path
  import json
  import numpy as np

  root = Path("out")
  root.mkdir(exist_ok=True)

  records = []

  for i in range(8):
      series_dir = root / f"series_smoke_{i:03d}"
      series_dir.mkdir(parents=True, exist_ok=True)

      volume = np.random.default_rng(i).normal(
          loc=0.0,
          scale=1.0,
          size=(1, 16, 224, 224)
      ).astype("float32")

      image_path = series_dir / "image.npy"
      np.save(image_path, volume)

      meta_path = series_dir / "meta.json"
      meta_path.write_text(json.dumps({
          "series_id": series_dir.name,
          "note": "Smoke-test placeholder data. Not real medical data."
      }, indent=2))

      records.append({
          "series_id": series_dir.name,
          "image_path": str(image_path),
          "meta_path": str(meta_path),
          "preview_path": "",
          "modality": "SMOKE",
          "num_slices_decoded": 16,
          "rows": 224,
          "columns": 224
      })

  (root / "manifest.json").write_text(json.dumps(records, indent=2))

  print("Created smoke-test data in out/")
  print("Wrote out/manifest.json")
  '@ | python

Train model on data:
- python train_model.py --data out --smoke --epochs 2 --output models/oral_ct_cnn.pt

Run prediction:
- python predict_model.py --model models/oral_ct_cnn.pt --data out

Clean generated files:
  deactivate
  cd ..
  Remove-Item -Recurse -Force .\dicom_pipeline\venv -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force .\dicom_pipeline\out -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force .\dicom_pipeline\models -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force .\dicom_pipeline\__pycache__ -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force .\dicom_pipeline\dicom_pipeline\__pycache__ -ErrorAction SilentlyContinue