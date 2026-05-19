import type { VolumeAsset } from '../utils/api';
import { formatPatientName, formatStudyDate } from '../utils/viewerTools';

interface StudyMetadataPanelProps {
  asset?: VolumeAsset;
  onCollapse: () => void;
}

function MetadataRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/6 py-2 last:border-b-0 last:pb-0 first:pt-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-100">{value}</dd>
    </div>
  );
}

export default function StudyMetadataPanel({ asset, onCollapse }: StudyMetadataPanelProps) {
  const study = asset?.study;

  return (
    <div
      className="w-[min(22rem,calc(100vw-2rem))] rounded-[1.6rem] border border-white/10 bg-slate-950/90 p-4 text-slate-100 shadow-[0_20px_45px_rgba(2,6,23,0.42)] backdrop-blur-md"
      data-testid="study-metadata-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            Study Metadata
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {study?.study_description ?? study?.series_description ?? 'CT Study Overview'}
          </p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="min-w-[6.5rem] rounded-full border border-slate-700/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition-colors hover:border-sky-300/40 hover:text-sky-100"
          data-testid="study-metadata-panel-collapse"
        >
          Hide Panel
        </button>
      </div>

      <dl className="mt-4">
        <MetadataRow label="Patient" value={formatPatientName(study?.patient_name)} />
        <MetadataRow label="Patient ID" value={study?.patient_id ?? 'Unavailable'} />
        <MetadataRow label="Sex / Age" value={`${study?.patient_sex ?? 'N/A'} / ${study?.patient_age ?? 'N/A'}`} />
        <MetadataRow label="Study Date" value={formatStudyDate(study?.study_date)} />
        <MetadataRow label="Modality" value={study?.modality ?? 'CT'} />
        <MetadataRow label="Institution" value={study?.institution_name ?? 'Unavailable'} />
        <MetadataRow label="Manufacturer" value={study?.manufacturer ?? 'Unavailable'} />
        <MetadataRow label="Series" value={study?.series_description ?? 'Unavailable'} />
        <MetadataRow label="Slices" value={study?.slice_count ?? asset?.dimensions[0] ?? 'Unknown'} />
        <MetadataRow label="Volume" value={`${asset?.dimensions.join(' x ') ?? 'Unknown'}`} />
        <MetadataRow label="Spacing" value={asset ? asset.spacing.map((value) => value.toFixed(2)).join(' / ') + ' mm' : 'Unknown'} />
        <MetadataRow label="HU Range" value={asset?.min_hu !== undefined && asset?.max_hu !== undefined ? `${asset.min_hu} to ${asset.max_hu}` : 'Unknown'} />
      </dl>
    </div>
  );
}