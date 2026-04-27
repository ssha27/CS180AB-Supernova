const API_BASE = '/api';

export interface UploadResponse {
  job_id: string;
  message: string;
}

export interface JobStatus {
  job_id: string;
  status: string;
  progress: number;
  message: string;
  elapsed_seconds: number;
  error: string | null;
}

export interface OrganInfo {
  id: number;
  name: string;
  color: number[];
  file: string;
  vertex_count: number;
  category: string;
}

export interface VolumeDirection {
  slice: [number, number, number];
  row: [number, number, number];
  column: [number, number, number];
}

export interface VolumeAsset {
  file: string;
  dimensions: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  dtype: string;
  byte_order: string;
  high_quality: boolean;
  affine?: number[][];
  direction?: VolumeDirection;
  min_hu?: number;
  max_hu?: number;
  min_label?: number;
  max_label?: number;
}

export interface VolumeBundle {
  intensity: VolumeAsset;
  segmentation: VolumeAsset;
}

export interface JobResult {
  organs: OrganInfo[];
  preload: string[];
  volume?: VolumeBundle;
}

export interface MemoryCheck {
  sufficient: boolean;
  available_gb: number;
  required_gb: number;
  message: string;
}

export interface RecentUpload {
  job_id: string;
  file_name: string;
  status: string;
  progress: number;
  message: string;
  error: string | null;
  seg_quality: string;
  vol_quality: string;
  created_at: string;
  updated_at: string;
  result_available: boolean;
  organ_count: number;
  preview_organs: string[];
}

export async function uploadDicom(
  file: File,
  segQuality: string,
  volQuality: string,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('seg_quality', segQuality);
  form.append('vol_quality', volQuality);

  const resp = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || 'Upload failed');
  }

  return resp.json();
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const resp = await fetch(`${API_BASE}/status/${jobId}`);
  if (!resp.ok) throw new Error('Failed to get job status');
  return resp.json();
}

export async function getJobResults(jobId: string): Promise<JobResult> {
  const resp = await fetch(`${API_BASE}/results/${jobId}`);
  if (!resp.ok) throw new Error('Failed to get results');
  return resp.json();
}

export async function checkMemory(quality: string): Promise<MemoryCheck> {
  const resp = await fetch(`${API_BASE}/memory-check?quality=${quality}`);
  if (!resp.ok) throw new Error('Memory check failed');
  return resp.json();
}

export async function getRecentUploads(): Promise<RecentUpload[]> {
  const resp = await fetch(`${API_BASE}/recent-uploads`);
  if (!resp.ok) throw new Error('Failed to load recent uploads');
  return resp.json();
}

export function getMeshUrl(jobId: string, filename: string): string {
  return `${API_BASE}/meshes/${jobId}/${filename}`;
}

export function getVolumeUrl(jobId: string, filename: string): string {
  return `${API_BASE}/volume/${jobId}/${filename}`;
}
