import argparse
import glob
import os
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out", help="Output root containing series_* folders")
    ap.add_argument("--series", default=None, help="Specific series folder (e.g., out/series_xxx). If omitted, picks first.")
    ap.add_argument("--num", type=int, default=5, help="How many slices to export (evenly spaced)")
    args = ap.parse_args()

    out_root = Path(args.out).expanduser().resolve()

    if args.series:
        series_dir = Path(args.series).expanduser().resolve()
    else:
        candidates = sorted(glob.glob(str(out_root / "series_*/")))
        if not candidates:
            raise FileNotFoundError(f"No series_* folders found under: {out_root}")
        series_dir = Path(candidates[0]).resolve()

    npy_path = series_dir / "image.npy"
    if not npy_path.exists():
        raise FileNotFoundError(f"Missing image.npy at: {npy_path}")

    x = np.load(npy_path)  # (1,D,H,W)
    D = x.shape[1]

    out_dir = series_dir / "sample_slices"
    out_dir.mkdir(exist_ok=True)

    k = max(1, args.num)
    if D == 1:
        idxs = [0]
    else:
        idxs = [round(i * (D - 1) / (k - 1)) for i in range(k)] if k > 1 else [D // 2]
        idxs = sorted(set(int(i) for i in idxs))

    for i in idxs:
        plt.imsave(out_dir / f"slice_{i:04d}.png", x[0, i], cmap="gray")

    print("Series:", series_dir)
    print("Saved slices to:", out_dir)
    print("D =", D, "exported idxs =", idxs)

if __name__ == "__main__":
    main()
