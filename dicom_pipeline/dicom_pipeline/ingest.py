import json
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from .config import PipelineConfig
from .deid import SENSITIVE_TAGS, UID_TAGS, get_salt, hashed_uids, scan_sensitive_fields, stable_hash
from .dicom_io import (
    discover_image_dicoms_in_folder,
    get_modality,
    get_pixel_spacing,
    get_slice_spacing,
    get_transfer_syntax,
    group_by_series_uid,
    is_image_dicom,
    read_ds,
    series_sort_key,
)
from .preprocess import apply_rescale, normalize_for_ml, photometric_invert_if_needed
from .outputs import save_series_outputs


def _build_safe_meta(ds, salt: str, num_slices_decoded: int, num_slices_total: int, decode_errors: int) -> Dict:
    modality = get_modality(ds)
    ps = get_pixel_spacing(ds)
    ss = get_slice_spacing(ds)

    iop = getattr(ds, "ImageOrientationPatient", None)
    ipp0 = getattr(ds, "ImagePositionPatient", None)

    meta = {
        "Modality": modality,
        "TransferSyntaxUID": get_transfer_syntax(ds),
        "PhotometricInterpretation": getattr(ds, "PhotometricInterpretation", None),
        "Rows": int(getattr(ds, "Rows", 0)),
        "Columns": int(getattr(ds, "Columns", 0)),
        "NumSlicesDecoded": int(num_slices_decoded),
        "NumSlicesInSeries": int(num_slices_total),
        "DecodeErrors": int(decode_errors),
        "PixelSpacing_rc_mm": list(ps) if ps else None,
        "SliceSpacing_mm": ss,
        "ImageOrientationPatient": list(iop) if iop is not None else None,
        "ImagePositionPatient_first": list(ipp0) if ipp0 is not None else None,
        **hashed_uids(ds, salt),
    }
    return meta


def _build_deid_report(ds, meta: Dict) -> Dict:
    present = scan_sensitive_fields(ds)
    return {
        "note": (
            "This pipeline does not write any direct patient identifiers or raw UIDs to disk. "
            "It stores only salted hashed UID tokens and non-identifying imaging metadata."
        ),
        "sensitive_fields_detected": {k: v for k, v in present.items() if v},
        "sensitive_fields_excluded": SENSITIVE_TAGS + UID_TAGS,
        "stored_hashed_uid_fields": [k for k in meta.keys() if k.endswith("_hash")],
    }


def _to_tensor(vol_raw: np.ndarray, modality: Optional[str], cfg: PipelineConfig) -> np.ndarray:
    vol_norm = normalize_for_ml(vol_raw, modality, cfg)
    return vol_norm[None, ...].astype(np.float32)


def _series_record(out_dir: Path, meta: Dict) -> Dict:
    return {
        "series_id": out_dir.name,
        "image_path": str((out_dir / "image.npy").resolve()),
        "meta_path": str((out_dir / "meta.json").resolve()),
        "preview_path": str((out_dir / "preview.png").resolve()),
        "modality": meta.get("Modality"),
        "num_slices_decoded": meta.get("NumSlicesDecoded"),
        "rows": meta.get("Rows"),
        "columns": meta.get("Columns"),
    }


def _write_manifest(output_root: Path, records: List[Dict]) -> None:
    output_root.mkdir(parents=True, exist_ok=True)
    payload = {
        "note": "Model-ready index of de-identified ingested DICOM series. Add labels later using series_id,label CSV.",
        "series": records,
    }
    (output_root / "manifest.json").write_text(json.dumps(payload, indent=2))


def _ingest_single_file(input_path: Path, output_root: Path, cfg: PipelineConfig, salt: str) -> Dict:
    ds = read_ds(input_path, stop_before_pixels=False)
    if not is_image_dicom(ds):
        raise ValueError("Input DICOM file does not contain image pixel data.")

    # Multi-frame
    nframes = getattr(ds, "NumberOfFrames", None)
    is_multiframe = False
    try:
        is_multiframe = nframes is not None and int(nframes) > 1
    except Exception:
        is_multiframe = False

    arr = ds.pixel_array.astype(np.float32)
    arr = photometric_invert_if_needed(arr, ds)
    arr, _ = apply_rescale(arr, ds)

    if arr.ndim == 2:
        vol = arr[None, ...]
    elif arr.ndim == 3:
        vol = arr
    else:
        raise ValueError(f"Unsupported pixel_array shape: {arr.shape}")

    meta = _build_safe_meta(ds, salt, vol.shape[0], vol.shape[0], 0)
    meta["MultiFrame"] = bool(is_multiframe)
    deid_report = _build_deid_report(ds, meta)

    key_src = str(getattr(ds, "SeriesInstanceUID", None) or getattr(ds, "SOPInstanceUID", "UNKNOWN"))
    series_key = stable_hash(key_src, salt)
    out_dir = output_root / f"series_{series_key}"

    tensor = _to_tensor(vol, meta.get("Modality"), cfg)
    save_series_outputs(out_dir, tensor, meta, deid_report)
    return _series_record(out_dir, meta)


def _ingest_folder(input_dir: Path, output_root: Path, cfg: PipelineConfig, salt: str, process_all_series: bool) -> List[Dict]:
    paths = discover_image_dicoms_in_folder(input_dir)
    if not paths:
        raise FileNotFoundError("No image DICOMs found in folder.")

    series_groups = group_by_series_uid(paths)
    series_uids = sorted(series_groups.keys(), key=lambda uid: len(series_groups[uid]), reverse=True)
    selected = series_uids if process_all_series else [series_uids[0]]
    records: List[Dict] = []

    for raw_uid in selected:
        slice_paths = series_groups[raw_uid]

        dsets = []
        for p in slice_paths:
            try:
                ds = read_ds(p, stop_before_pixels=False)
                if is_image_dicom(ds):
                    dsets.append(ds)
            except Exception:
                continue

        if not dsets:
            continue

        dsets = sorted(dsets, key=series_sort_key)

        slices: List[np.ndarray] = []
        decode_errors = 0
        for ds in dsets:
            try:
                arr = ds.pixel_array.astype(np.float32)
            except Exception:
                decode_errors += 1
                continue

            arr = photometric_invert_if_needed(arr, ds)
            arr, _ = apply_rescale(arr, ds)
            slices.append(arr)

        if not slices:
            raise RuntimeError("All slices failed to decode pixel data (decoder missing or corrupted files).")

        vol = np.stack(slices, axis=0)  # (D,H,W)
        ref = dsets[0]

        meta = _build_safe_meta(ref, salt, vol.shape[0], len(dsets), decode_errors)
        deid_report = _build_deid_report(ref, meta)

        series_key = stable_hash(str(raw_uid), salt)
        out_dir = output_root / f"series_{series_key}"

        tensor = _to_tensor(vol, meta.get("Modality"), cfg)
        save_series_outputs(out_dir, tensor, meta, deid_report)
        records.append(_series_record(out_dir, meta))

    return records


def ingest_path(input_path: Path, output_root: Path, process_all_series: bool = False, user_salt: Optional[str] = None) -> List[Dict]:
    cfg = PipelineConfig()
    salt = get_salt(user_salt)

    input_path = input_path.expanduser().resolve()
    output_root = output_root.expanduser().resolve()

    if input_path.is_file():
        records = [_ingest_single_file(input_path, output_root, cfg, salt)]
    elif input_path.is_dir():
        records = _ingest_folder(input_path, output_root, cfg, salt, process_all_series=process_all_series)
    else:
        raise FileNotFoundError(f"Input path not found: {input_path}")

    _write_manifest(output_root, records)
    return records
