from pathlib import Path
import argparse
import pydicom

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Folder containing DICOM files")
    args = ap.parse_args()

    folder = Path(args.input).expanduser().resolve()
    paths = [p for p in folder.rglob("*") if p.is_file()]
    print("Input folder:", folder)
    print("Total files:", len(paths))

    dicomish = 0
    image_like = 0

    samples = 0
    for p in paths:
        try:
            ds = pydicom.dcmread(str(p), force=True, stop_before_pixels=True)
            dicomish += 1
        except Exception:
            continue

        mod = getattr(ds, "Modality", None)
        sop = getattr(ds, "SOPClassUID", None)
        rows = getattr(ds, "Rows", None)
        cols = getattr(ds, "Columns", None)

        has_pixel_tag = ("PixelData" in ds)
        has_dims = rows is not None and cols is not None

        if has_pixel_tag or has_dims:
            image_like += 1

        if samples < 10:
            print("\n---", p.name, "---")
            print("  Modality:", mod)
            print("  SOPClassUID:", sop)
            print("  Rows/Cols:", rows, cols)
            print("  Has PixelData tag:", has_pixel_tag)
            print("  FileMeta TSUID:", getattr(getattr(ds, "file_meta", None), "TransferSyntaxUID", None))
            samples += 1

    print("\nParsed as DICOM (force=True):", dicomish)
    print("Image-like (PixelData tag OR Rows/Cols):", image_like)

if __name__ == "__main__":
    main()

# Run: python debug_folder.py --input "/path/to/dicom_folder"