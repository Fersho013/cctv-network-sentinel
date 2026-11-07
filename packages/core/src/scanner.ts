export type ScanStatus = 'ONLINE' | 'OFFLINE';

export interface ScanResult {
  ip: string;
  status: ScanStatus;
  rtspOpen: boolean;
  httpOpen: boolean;
  latencyMs: number;
  lastSeen: Date;
}

const RTSP_PORT = 554;
const HTTP_PORTS = [80, 443];

function pingHost(ip: string, timeoutMs = 1000): Promise<number> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new (require('net').Socket)();
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => {
      const latency = Date.now() - start;
      sock.destroy();
      resolve(latency);
    });
    sock.on('timeout', () => {
      sock.destroy();
      resolve(-1);
    });
    sock.on('error', () => {
      sock.destroy();
      resolve(-1);
    });
    sock.connect(80, ip);
  });
}

function checkPort(ip: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new (require('net').Socket)();
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.on('error', () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, ip);
  });
}

export async function scanLocalSubnet(subnet: string): Promise<ScanResult[]> {
  const base = subnet.endsWith('.') ? subnet : subnet + '.';
  const results: ScanResult[] = [];

  const tasks = Array.from({ length: 254 }, (_, i) => i + 1).map(async (n) => {
    const ip = `${base}${n}`;
    const latency = await pingHost(ip);
    const online = latency >= 0;
    const rtspOpen = online ? await checkPort(ip, RTSP_PORT) : false;
    const httpOpen = online
      ? (await Promise.all(HTTP_PORTS.map((p) => checkPort(ip, p)))).some(Boolean)
      : false;
    results.push({
      ip,
      status: online ? 'ONLINE' : 'OFFLINE',
      rtspOpen,
      httpOpen,
      latencyMs: online ? latency : -1,
      lastSeen: new Date(),
    });
  });

  await Promise.all(tasks);
  return results.sort((a, b) => {
    const an = parseInt(a.ip.split('.').pop() || '0', 10);
    const bn = parseInt(b.ip.split('.').pop() || '0', 10);
    return an - bn;
  });
}
