import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchAlerts,
  fetchCameras,
  scanSubnet,
  type Alert,
  type Camera,
} from '../api';

const POLL_INTERVAL_MS = 10_000;

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const DashboardGrid: React.FC = () => {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [subnet, setSubnet] = useState('192.168.1');
  const [scanning, setScanning] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const online = cameras.filter((camera) => camera.status === 'ONLINE').length;
  const offline = cameras.length - online;

  const load = useCallback(async () => {
    try {
      const [nextCameras, nextAlerts] = await Promise.all([fetchCameras(), fetchAlerts()]);
      setCameras(nextCameras);
      setAlerts(nextAlerts);
      setError(null);
    } catch (err) {
      setError(`No se pudo conectar con el servidor: ${errorMessage(err)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const rescan = async () => {
    setScanning(true);
    setError(null);
    setScanMessage(null);

    try {
      const result = await scanSubnet(subnet);
      setScanMessage(
        `${result.onlineHosts} hosts respondieron, ${result.candidates.length} candidatos. ` +
          `${result.summary.added} nuevas, ${result.summary.updated} actualizadas, ` +
          `${result.summary.offline} marcadas offline (${(result.durationMs / 1000).toFixed(1)} s).`,
      );
      await load();
    } catch (err) {
      setError(`El escaneo falló: ${errorMessage(err)}`);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <main className="flex-1 overflow-y-auto p-6">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-emerald-400">CCTV Network Sentinel</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Escaneo de red y monitorización de cámaras en tiempo real
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-zinc-400">
              Subred /24
              <input
                value={subnet}
                onChange={(event) => setSubnet(event.target.value)}
                placeholder="192.168.1"
                className="w-40 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-emerald-500"
              />
            </label>
            <button
              onClick={rescan}
              disabled={scanning}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-60"
            >
              {scanning ? 'Escaneando...' : 'Escanear red'}
            </button>
          </div>
        </header>

        <section className="mb-5 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Online</p>
            <p className="text-2xl font-bold text-emerald-400">{online}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Offline</p>
            <p className="text-2xl font-bold text-red-400">{offline}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Total</p>
            <p className="text-2xl font-bold text-zinc-100">{cameras.length}</p>
          </div>
        </section>

        {scanning && (
          <div className="mb-4 flex items-center gap-2 text-sm text-amber-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            Escaneando {subnet}.0/24 en busca de RTSP/HTTP...
          </div>
        )}

        {scanMessage && !scanning && (
          <div className="mb-4 rounded-md border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">
            {scanMessage}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {cameras.length === 0 && !scanning && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
            <p className="mb-2 text-zinc-300">No hay cámaras registradas todavía.</p>
            <p className="text-sm text-zinc-500">
              Introduce tu subred y pulsa «Escanear red» para descubrir dispositivos con RTSP o
              HTTP abiertos.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cameras.map((camera) => (
            <div
              key={camera.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate font-medium">{camera.name}</span>
                <span
                  className={`h-3 w-3 shrink-0 rounded-full ${
                    camera.status === 'ONLINE' ? 'animate-pulse bg-emerald-500' : 'bg-red-500'
                  }`}
                  title={camera.status}
                />
              </div>

              <p className="text-xs text-zinc-400">{camera.ipAddress}</p>

              <div className="mt-2 flex flex-wrap gap-1 text-[10px] uppercase tracking-wide">
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-300">{camera.brand}</span>
                {camera.rtspOpen && (
                  <span className="rounded bg-emerald-900/60 px-2 py-0.5 text-emerald-300">RTSP</span>
                )}
                {camera.httpOpen && (
                  <span className="rounded bg-sky-900/60 px-2 py-0.5 text-sky-300">HTTP</span>
                )}
              </div>

              <p className="mt-3 text-sm">
                Latencia:{' '}
                <span className="text-amber-400">
                  {camera.latencyMs >= 0 ? `${camera.latencyMs} ms` : 'N/A'}
                </span>
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Última vez: {camera.lastSeen ? formatTimestamp(camera.lastSeen) : 'nunca'}
              </p>
            </div>
          ))}
        </div>
      </main>

      <aside
        className={`${panelOpen ? 'w-80' : 'w-0'} shrink-0 overflow-hidden border-l border-zinc-800 bg-zinc-900 transition-all`}
      >
        <div className="p-4">
          <h2 className="mb-4 text-lg font-semibold text-amber-400">
            Alertas {alerts.length > 0 && `(${alerts.length})`}
          </h2>
          {alerts.length === 0 && <p className="text-sm text-zinc-500">Sin alertas por ahora.</p>}
          {alerts.map((alert) => (
            <div key={alert.id} className="mb-3 rounded-md bg-zinc-800 p-3 text-sm">
              <p className="text-zinc-200">{alert.message}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {alert.severity} · {formatTimestamp(alert.timestamp)}
              </p>
            </div>
          ))}
        </div>
      </aside>

      <button
        onClick={() => setPanelOpen((open) => !open)}
        className="fixed right-0 top-1/2 -translate-y-1/2 rounded-l-md bg-zinc-800 px-2 py-4"
        aria-label="Mostrar u ocultar alertas"
      >
        {panelOpen ? '›' : '‹'}
      </button>
    </div>
  );
};

export default DashboardGrid;
