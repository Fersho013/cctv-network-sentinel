export type CameraStatus = 'ONLINE' | 'OFFLINE';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Camera {
  id: number;
  name: string;
  brand: string;
  ipAddress: string;
  status: CameraStatus;
  latencyMs: number;
  rtspOpen: boolean;
  httpOpen: boolean;
  lastSeen: string | null;
}

export interface Alert {
  id: number;
  cameraId: number | null;
  message: string;
  severity: AlertSeverity;
  timestamp: string;
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

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

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

export function scanSubnet(subnet: string) {
  return request<ScanResponse>('/api/scan', {
    method: 'POST',
    body: JSON.stringify({ subnet }),
  });
}
