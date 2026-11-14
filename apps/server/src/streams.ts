import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HLS_ROOT = path.join(os.tmpdir(), 'cctv-sentinel-hls');
const IDLE_TIMEOUT_MS = 60_000;
const RESTART_DELAY_MS = 3_000;
const PLAYLIST_WAIT_MS = 10_000;

export { HLS_ROOT };

type StreamMode = 'copy' | 'transcode';

interface StreamSession {
  cameraId: number;
  rtspUrl: string;
  dir: string;
  mode: StreamMode;
  child: ChildProcess | null;
  lastAccess: number;
  startedAt: number;
  restartTimer: NodeJS.Timeout | null;
  stopped: boolean;
  producedSegments: boolean;
}

const sessions = new Map<number, StreamSession>();
let ffmpegBinary: string | null = null;
let ffprobeBinary: string | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;

function findWinGetBinary(binary: string): string | undefined {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return undefined;

  const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(packagesDir)) return undefined;

  const exeName = process.platform === 'win32' ? `${binary}.exe` : binary;

  for (const packageEntry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!packageEntry.isDirectory() || !/ffmpeg/i.test(packageEntry.name)) continue;

    const packagePath = path.join(packagesDir, packageEntry.name);
    for (const buildEntry of fs.readdirSync(packagePath, { withFileTypes: true })) {
      if (!buildEntry.isDirectory()) continue;
      const candidate = path.join(packagePath, buildEntry.name, 'bin', exeName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

function resolveBinary(binary: 'ffmpeg' | 'ffprobe'): string {
  const envKey = binary === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH';
  const fromEnv = process.env[envKey];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  // Si FFMPEG_PATH apunta a la carpeta bin, deducimos el otro binario.
  const sibling = process.env.FFMPEG_PATH
    ? path.join(path.dirname(process.env.FFMPEG_PATH), `${binary}.exe`)
    : undefined;
  if (sibling && fs.existsSync(sibling)) return sibling;

  const fromWinGet = findWinGetBinary(binary);
  if (fromWinGet) return fromWinGet;

  return binary;
}

export function getFfmpegPath(): string {
  if (!ffmpegBinary) ffmpegBinary = resolveBinary('ffmpeg');
  return ffmpegBinary;
}

export function getFfprobePath(): string {
  if (!ffprobeBinary) ffprobeBinary = resolveBinary('ffprobe');
  return ffprobeBinary;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function listSegments(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((file) => file.endsWith('.ts'));
  } catch {
    return [];
  }
}

function clearDir(dir: string) {
  try {
    for (const file of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, file), { force: true, recursive: true });
    }
  } catch {
    // Si Windows mantiene el archivo bloqueado, se limpiará en el siguiente intento.
  }
}

function inputArgs(source: string): string[] {
  const args = ['-hide_banner', '-loglevel', 'error'];

  if (/^rtsps?:\/\//i.test(source)) {
    args.push('-rtsp_transport', 'tcp');
  }

  args.push('-i', source);
  return args;
}

function buildArgs(session: StreamSession): string[] {
  const playlist = path.join(session.dir, 'index.m3u8');
  const segmentPattern = path.join(session.dir, 'seg_%05d.ts');
  const args = [...inputArgs(session.rtspUrl)];

  if (session.mode === 'transcode') {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '50',
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-ar',
      '44100',
    );
  } else {
    args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-ar', '44100');
  }

  args.push(
    '-f',
    'hls',
    '-hls_time',
    '1',
    '-hls_list_size',
    '6',
    '-hls_flags',
    'delete_segments+omit_endlist',
    '-hls_segment_filename',
    segmentPattern,
    playlist,
  );

  return args;
}

function spawnSession(session: StreamSession) {
  clearDir(session.dir);

  const child = spawn(getFfmpegPath(), buildArgs(session), {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  session.child = child;
  session.startedAt = Date.now();
  session.producedSegments = false;

  child.stderr?.on('data', (chunk: Buffer) => {
    if (process.env.FFMPEG_DEBUG === '1') {
      // Nunca escribas credenciales RTSP en los logs.
      const text = chunk.toString().replace(/\/\/([^:/@\s]+):([^@\s]*)@/g, '//$1:***@');
      process.stderr.write(`[ffmpeg ${session.cameraId}] ${text}`);
    }
  });

  child.on('exit', (code) => {
    session.child = null;
    if (session.stopped) return;

    const failedWithoutOutput = !session.producedSegments && listSegments(session.dir).length === 0;

    // Si el canal no es H.264, el modo copy no produce segmentos:
    // reintentamos una vez transcodificando a H.264.
    if (failedWithoutOutput && session.mode === 'copy' && code !== 0) {
      session.mode = 'transcode';
    }

    if (Date.now() - session.lastAccess > IDLE_TIMEOUT_MS) {
      destroySession(session);
      return;
    }

    session.restartTimer = setTimeout(() => {
      session.restartTimer = null;
      if (!session.stopped) spawnSession(session);
    }, RESTART_DELAY_MS);
  });
}

function destroySession(session: StreamSession) {
  session.stopped = true;
  session.lastAccess = 0;

  if (session.restartTimer) {
    clearTimeout(session.restartTimer);
    session.restartTimer = null;
  }

  if (session.child) {
    session.child.kill('SIGKILL');
    session.child = null;
  }

  sessions.delete(session.cameraId);
  clearDir(session.dir);
  try {
    fs.rmSync(session.dir, { recursive: true, force: true });
  } catch {
    // Windows puede tardar en liberar los segmentos.
  }
}

function startCleanupTimer() {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (now - session.lastAccess > IDLE_TIMEOUT_MS) destroySession(session);
      else if (listSegments(session.dir).length > 0) session.producedSegments = true;
    }
  }, 5_000);

  cleanupTimer.unref();
}

/**
 * Asegura que hay un proceso FFmpeg generando HLS para la cámara.
 * Devuelve la carpeta donde se escriben el playlist y los segmentos.
 */
export function ensureStream(cameraId: number, rtspUrl: string): string {
  startCleanupTimer();

  const dir = path.join(HLS_ROOT, String(cameraId));
  ensureDir(dir);

  const existing = sessions.get(cameraId);
  if (existing && existing.rtspUrl === rtspUrl) {
    existing.lastAccess = Date.now();
    return existing.dir;
  }

  if (existing) destroySession(existing);

  const session: StreamSession = {
    cameraId,
    rtspUrl,
    dir,
    mode: 'copy',
    child: null,
    lastAccess: Date.now(),
    startedAt: Date.now(),
    restartTimer: null,
    stopped: false,
    producedSegments: false,
  };

  sessions.set(cameraId, session);
  spawnSession(session);
  return dir;
}

export function touchStream(cameraId: number) {
  const session = sessions.get(cameraId);
  if (session) session.lastAccess = Date.now();
}

export function stopStream(cameraId: number) {
  const session = sessions.get(cameraId);
  if (session) destroySession(session);
}

export function stopAllStreams() {
  for (const session of [...sessions.values()]) destroySession(session);
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function isStreamRunning(cameraId: number): boolean {
  const session = sessions.get(cameraId);
  return Boolean(session && !session.stopped);
}

export function getStreamMode(cameraId: number): StreamMode | null {
  return sessions.get(cameraId)?.mode ?? null;
}

export async function waitForPlaylist(dir: string, timeoutMs = PLAYLIST_WAIT_MS): Promise<boolean> {
  const playlist = path.join(dir, 'index.m3u8');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (fs.existsSync(playlist) && listSegments(dir).length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

/**
 * Captura un fotograma JPEG de la cámara usando FFmpeg.
 */
export function captureSnapshot(rtspUrl: string, timeoutMs = 15_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      ...inputArgs(rtspUrl),
      '-an',
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-q:v',
      '3',
      'pipe:1',
    ];

    const child = spawn(getFfmpegPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const chunks: Buffer[] = [];
    let settled = false;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');

      if (error) reject(error);
      else if (chunks.length === 0) reject(new Error('FFmpeg no devolvió imagen.'));
      else resolve(Buffer.concat(chunks));
    };

    const timer = setTimeout(() => finish(new Error('Tiempo de espera agotado al capturar imagen.')), timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', () => undefined);
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => {
      if (code === 0) finish(null);
      else finish(new Error(`FFmpeg terminó con código ${code}.`));
    });
  });
}

export interface ProbeResult {
  ok: boolean;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  error?: string;
}

/**
 * Comprueba que una URL RTSP responde y devuelve los datos del canal de vídeo.
 */
export function probeStream(rtspUrl: string, timeoutMs = 15_000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-loglevel', 'error'];

    if (/^rtsps?:\/\//i.test(rtspUrl)) {
      args.push('-rtsp_transport', 'tcp');
    }

    args.push(
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height,avg_frame_rate',
      '-of',
      'json',
      rtspUrl,
    );

    const child = spawn(getFfprobePath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, error: 'La cámara no respondió a tiempo (RTSP).' }),
      timeoutMs,
    );

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', (error) =>
      finish({ ok: false, error: `No se pudo ejecutar FFprobe: ${error.message}` }),
    );

    child.on('exit', (code) => {
      if (code !== 0) {
        const message = Buffer.concat(stderr).toString().trim().split('\n').pop();
        finish({
          ok: false,
          error: message || `FFprobe terminó con código ${code}.`,
        });
        return;
      }

      try {
        const parsed = JSON.parse(Buffer.concat(stdout).toString()) as {
          streams?: Array<{
            codec_name?: string;
            width?: number;
            height?: number;
            avg_frame_rate?: string;
          }>;
        };

        const stream = parsed.streams?.[0];
        if (!stream) {
          finish({ ok: false, error: 'La cámara no devolvió ningún canal de vídeo.' });
          return;
        }

        const [num, den] = (stream.avg_frame_rate ?? '').split('/').map(Number);
        finish({
          ok: true,
          codec: stream.codec_name,
          width: stream.width,
          height: stream.height,
          fps: num && den ? Math.round(num / den) : undefined,
        });
      } catch {
        finish({ ok: false, error: 'No se pudo interpretar la respuesta de FFprobe.' });
      }
    });
  });
}
