"""
CLI entrypoint for ingestion.

Examples:
  export DICOM_DEID_SALT="secret"
  python run_ingest.py --input ./dicoms --output ./out
  python run_ingest.py --input ./dicoms --output ./out --all_series
"""

import argparse
from pathlib import Path

from dicom_pipeline.ingest import ingest_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Path to a DICOM file or folder")
    ap.add_argument("--output", default="dicom_ingested", help="Output directory")
    ap.add_argument("--all_series", action="store_true", help="Process all series in folder")
    ap.add_argument("--salt", default=None, help="Salt for hashing (or set env DICOM_DEID_SALT)")
    args = ap.parse_args()

    ingest_path(
        input_path=Path(args.input),
        output_root=Path(args.output),
        process_all_series=args.all_series,
        user_salt=args.salt,
    )

    print("Done.")


if __name__ == "__main__":
    main()