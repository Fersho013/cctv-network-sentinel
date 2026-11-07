import { scanLocalSubnet } from '@cctv/core';

export async function sendHeartbeat(camera: { id: number; status: string; latency: number }) {
  await fetch('http://localhost:3000/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(camera),
  });
}

export async function runScanAndReport(subnet: string) {
  const results = await scanLocalSubnet(subnet);
  for (const r of results) {
    await sendHeartbeat({ id: 0, status: r.status, latency: r.latencyMs });
  }
  return results;
}
