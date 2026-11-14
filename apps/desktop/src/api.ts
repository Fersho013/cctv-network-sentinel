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

const TOKEN_KEY = 'cctv.token';

let unauthorizedHandler: (() => void) | null = null;

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Sin almacenamiento el token vive solo mientras dure la pestaña.
  }
}

export function logout() {
  setToken(null);
}

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface AuthStatus {
  authDisabled: boolean;
  authenticated: boolean;
}

export function authStatus() {
  return request<AuthStatus>('/api/auth/status');
}

export async function login(pin: string) {
  const result = await request<{ token: string; expiresAt: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
  setToken(result.token);
  return result;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (response.status === 401) {
    setToken(null);
    unauthorizedHandler?.();
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Sesión expirada. Vuelve a introducir el PIN.');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Error ${response.status} al llamar a ${path}`);
  }

  return (await response.json()) as T;
}

/** Añade el token a URLs que se piden sin cabeceras (img, video, HLS). */
export function withToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
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
  return withToken(`${API_BASE}/api/cameras/${id}/snapshot?t=${cacheBuster}`);
}

export function liveUrl(hlsUrl: string) {
  return withToken(hlsUrl.startsWith('http') ? hlsUrl : `${API_BASE}${hlsUrl}`);
}

export function scanSubnet(subnet: string) {
  return request<ScanResponse>('/api/scan', {
    method: 'POST',
    body: JSON.stringify({ subnet }),
  });
}
