export type CameraStatus = 'ONLINE' | 'OFFLINE';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Camera {
  id: number;
  name: string;
  brand: string;
  ipAddress: string;
  rtspPort: number;
  channel: number;
  username: string;
  hasPassword: boolean;
  streamPath: string;
  status: CameraStatus;
  latencyMs: number;
  rtspOpen: boolean;
  httpOpen: boolean;
  lastSeen: string | null;
  createdAt: string;
  streaming: boolean;
}

export interface Alert {
  id: number;
  cameraId: number | null;
  message: string;
  severity: AlertSeverity;
  acknowledged: boolean;
  timestamp: string;
}

export interface CameraPreset {
  id: string;
  label: string;
  rtspPort: number;
  streamPath: string;
  subStreamPath?: string;
  notes?: string;
}

export interface CameraInput {
  name: string;
  brand: string;
  ipAddress: string;
  rtspPort?: number;
  channel?: number;
  username?: string;
  password?: string;
  streamPath?: string;
}

export interface StreamInfo {
  hlsUrl: string;
  mode: 'copy' | 'transcode' | null;
  streaming: boolean;
}

export interface TestResult {
  ok: boolean;
  tcpOpen: boolean;
  latencyMs?: number;
  url: string;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  error?: string;
}

export interface ScanCandidate {
  ip: string;
  status: CameraStatus;
  rtspOpen: boolean;
  httpOpen: boolean;
  latencyMs: number;
  lastSeen: string;
}

export interface ScanResponse {
  subnet: string;
  durationMs: number;
  scannedAt: string;
  totalHosts: number;
  onlineHosts: number;
  candidates: ScanCandidate[];
  summary: {
    added: number;
    updated: number;
    offline: number;
  };
}

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Error ${response.status} al llamar a ${path}`);
  }

  return (await response.json()) as T;
}

export function fetchCameras() {
  return request<Camera[]>('/api/cameras');
}

export function fetchAlerts() {
  return request<Alert[]>('/api/alerts');
}

export function fetchPresets() {
  return request<CameraPreset[]>('/api/camera-presets');
}

export function createCamera(input: CameraInput) {
  return request<Camera>('/api/cameras', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCamera(id: number, input: Partial<CameraInput>) {
  return request<Camera>(`/api/cameras/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteCamera(id: number) {
  return request<{ deleted: boolean }>(`/api/cameras/${id}`, { method: 'DELETE' });
}

export function testCamera(input: Partial<CameraInput> & { cameraId?: number }) {
  return request<TestResult>('/api/cameras/test', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function startLive(id: number) {
  return request<StreamInfo>(`/api/cameras/${id}/live`);
}

export function stopLive(id: number) {
  return request<{ stopped: boolean }>(`/api/cameras/${id}/stream/stop`, { method: 'POST' });
}

export function snapshotUrl(id: number, cacheBuster = 0) {
  return `${API_BASE}/api/cameras/${id}/snapshot?t=${cacheBuster}`;
}

export function liveUrl(hlsUrl: string) {
  return hlsUrl.startsWith('http') ? hlsUrl : `${API_BASE}${hlsUrl}`;
}

export function scanSubnet(subnet: string) {
  return request<ScanResponse>('/api/scan', {
    method: 'POST',
    body: JSON.stringify({ subnet }),
  });
}
