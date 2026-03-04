import glob, os, json
import numpy as np

series_dirs = sorted(glob.glob("out/series_*/"))
if not series_dirs:
    raise FileNotFoundError("No out/series_*/ found. Did ingestion run and produce outputs?")

print(f"Found {len(series_dirs)} series folders.\n")

for sd in series_dirs:
    meta_path = os.path.join(sd, "meta.json")
    npy_path  = os.path.join(sd, "image.npy")
    if not (os.path.exists(meta_path) and os.path.exists(npy_path)):
        print("SKIP (missing files):", sd)
        continue

    meta = json.load(open(meta_path))
    x = np.load(npy_path)

    print("Series:", sd)
    print("  Modality:", meta.get("Modality"))
    print("  tensor_shape:", x.shape, "dtype:", x.dtype)
    print("  NumSlicesDecoded:", meta.get("NumSlicesDecoded"),
          "NumSlicesInSeries:", meta.get("NumSlicesInSeries"),
          "DecodeErrors:", meta.get("DecodeErrors"))
    print("  PixelSpacing_rc_mm:", meta.get("PixelSpacing_rc_mm"),
          "SliceSpacing_mm:", meta.get("SliceSpacing_mm"))
    print("  value range:", float(x.min()), float(x.max()), "mean:", float(x.mean()))
    print("  preview:", os.path.join(sd, "preview.png"))
    print()
