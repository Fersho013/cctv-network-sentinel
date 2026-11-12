import net from 'node:net';

export type ScanStatus = 'ONLINE' | 'OFFLINE';

export interface ScanResult {
  ip: string;
  status: ScanStatus;
  rtspOpen: boolean;
  httpOpen: boolean;
  latencyMs: number;
  lastSeen: Date;
}

export interface ScanOptions {
  timeoutMs?: number;
  concurrency?: number;
}

const RTSP_PORT = 554;
const HTTP_PORTS = [80, 443, 8000, 8080];
const DEFAULT_TIMEOUT_MS = 700;
const DEFAULT_CONCURRENCY = 64;

/**
 * Comprueba un puerto TCP y devuelve la latencia en ms, o -1 si está cerrado.
 */
export function checkTcpPort(
  ip: string,
  port: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<number> {
  return probePort(ip, port, timeoutMs);
}

function probePort(ip: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (latency: number) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(latency);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(Date.now() - start));
    socket.once('timeout', () => finish(-1));
    socket.once('error', () => finish(-1));
    socket.connect(port, ip);
  });
}

/**
 * Comprueba los puertos habituales de una cámara IP.
 * La latencia es la del primer puerto que responde.
 */
export async function scanHost(ip: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ScanResult> {
  const [rtspLatency, ...httpLatencies] = await Promise.all([
    probePort(ip, RTSP_PORT, timeoutMs),
    ...HTTP_PORTS.map((port) => probePort(ip, port, timeoutMs)),
  ]);

  const successes = [rtspLatency, ...httpLatencies].filter((latency) => latency >= 0);
  const online = successes.length > 0;

  return {
    ip,
    status: online ? 'ONLINE' : 'OFFLINE',
    rtspOpen: rtspLatency >= 0,
    httpOpen: httpLatencies.some((latency) => latency >= 0),
    latencyMs: online ? Math.min(...successes) : -1,
    lastSeen: new Date(),
  };
}

/**
 * Normaliza una subred /24. Acepta "192.168.1", "192.168.1." o "192.168.1.0/24".
 */
export function normalizeSubnet(subnet: string): string {
  const cleaned = subnet.trim().replace(/\/24$/, '').replace(/\.$/, '');
  const octets = cleaned.split('.');

  if (octets.length === 4 && octets[3] === '0') {
    octets.pop();
  }

  if (octets.length !== 3) {
    throw new Error('Subred inválida. Usa el formato 192.168.1 o 192.168.1.0/24.');
  }

  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet) || Number(octet) > 255) {
      throw new Error(`Octeto inválido: "${octet}".`);
    }
  }

  return `${octets.join('.')}.`;
}

async function forEachLimited<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index]);
    }
  });

  await Promise.all(workers);
}

/**
 * Escanea los 254 hosts de una subred /24 en busca de RTSP/HTTP abiertos.
 */
export async function scanLocalSubnet(
  subnet: string,
  options: ScanOptions = {},
): Promise<ScanResult[]> {
  const base = normalizeSubnet(subnet);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const results: ScanResult[] = [];

  await forEachLimited(
    Array.from({ length: 254 }, (_, index) => index + 1),
    concurrency,
    async (host) => {
      results.push(await scanHost(`${base}${host}`, timeoutMs));
    },
  );

  return results.sort((a, b) => {
    const an = Number(a.ip.split('.').pop() ?? 0);
    const bn = Number(b.ip.split('.').pop() ?? 0);
    return an - bn;
  });
}
