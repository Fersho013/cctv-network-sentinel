export interface CameraPreset {
  id: string;
  label: string;
  rtspPort: number;
  /** Ruta RTSP por defecto para el canal principal (alta calidad). */
  streamPath: string;
  /** Ruta RTSP opcional para el canal secundario (baja calidad). */
  subStreamPath?: string;
  notes?: string;
}

/**
 * Presets de las marcas más habituales. La ruta puede contener {channel}
 * y se sustituye por el canal configurado en la cámara.
 */
export const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'tapo',
    label: 'TP-Link Tapo',
    rtspPort: 554,
    streamPath: '/stream1',
    subStreamPath: '/stream2',
    notes: 'Crea una «cuenta de cámara» en la app Tapo antes de usar RTSP.',
  },
  {
    id: 'hikvision',
    label: 'Hikvision',
    rtspPort: 554,
    streamPath: '/Streaming/Channels/{channel}01',
    subStreamPath: '/Streaming/Channels/{channel}02',
  },
  {
    id: 'dahua',
    label: 'Dahua',
    rtspPort: 554,
    streamPath: '/cam/realmonitor?channel={channel}&subtype=0',
    subStreamPath: '/cam/realmonitor?channel={channel}&subtype=1',
  },
  {
    id: 'reolink',
    label: 'Reolink',
    rtspPort: 554,
    streamPath: '/h264Preview_{channel:2}_main',
    subStreamPath: '/h264Preview_{channel:2}_sub',
  },
  {
    id: 'amcrest',
    label: 'Amcrest',
    rtspPort: 554,
    streamPath: '/cam/realmonitor?channel={channel}&subtype=0',
    subStreamPath: '/cam/realmonitor?channel={channel}&subtype=1',
  },
  {
    id: 'axis',
    label: 'Axis',
    rtspPort: 554,
    streamPath: '/axis-media/media.amp',
  },
  {
    id: 'generic',
    label: 'Genérica / otra',
    rtspPort: 554,
    streamPath: '/stream1',
    notes: 'Ajusta la ruta RTSP según el manual de tu cámara.',
  },
];

export interface CameraConnection {
  brand: string;
  ipAddress: string;
  rtspPort: number;
  channel: number;
  username: string;
  password: string;
  streamPath: string;
}

export function getPreset(brand: string): CameraPreset | undefined {
  const id = brand.trim().toLowerCase();
  return CAMERA_PRESETS.find((preset) => preset.id === id);
}

function applyChannel(template: string, channel: number): string {
  return template
    .replace(/\{channel:2\}/g, String(channel).padStart(2, '0'))
    .replace(/\{channel\}/g, String(channel));
}

/**
 * Devuelve la ruta RTSP efectiva. Si la cámara no tiene ruta guardada,
 * se usa la del preset de su marca y el canal indicado.
 */
export function resolveStreamPath(
  brand: string,
  streamPath: string,
  channel: number,
): string {
  const trimmed = streamPath.trim();
  if (trimmed) return applyChannel(trimmed, channel);

  const preset = getPreset(brand);
  return applyChannel(preset?.streamPath ?? '/stream1', channel);
}

/**
 * Construye la URL RTSP con credenciales codificadas. Si streamPath ya es
 * una URL completa se respeta, inyectando credenciales solo si no las tiene.
 */
export function buildRtspUrl(connection: CameraConnection): string {
  const path = resolveStreamPath(connection.brand, connection.streamPath, connection.channel);

  if (/^rtsps?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (!url.username && connection.username) {
        url.username = connection.username;
        url.password = connection.password;
      }
      return url.toString();
    } catch {
      return path;
    }
  }

  const auth = connection.username
    ? `${encodeURIComponent(connection.username)}:${encodeURIComponent(connection.password)}@`
    : '';

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `rtsp://${auth}${connection.ipAddress}:${connection.rtspPort}${normalizedPath}`;
}

/**
 * Oculta la contraseña de una URL RTSP para mostrarla en logs o respuestas.
 */
export function maskRtspUrl(rtspUrl: string): string {
  return rtspUrl.replace(/\/\/([^:/@]+):([^@]*)@/, '//$1:***@');
}
