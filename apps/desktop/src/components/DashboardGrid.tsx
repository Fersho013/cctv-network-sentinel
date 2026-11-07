import React, { useState, useEffect } from 'react';

interface Camera {
  id: number;
  name: string;
  ipAddress: string;
  status: 'ONLINE' | 'OFFLINE';
  latencyMs: number;
}

interface Alert {
  id: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
}

const INITIAL_MOCK: Camera[] = [
  { id: 1, name: 'DVR Hikvision 4CH', ipAddress: '192.168.1.10', status: 'ONLINE', latencyMs: 12 },
  { id: 2, name: 'Tapo C200 - Salon', ipAddress: '192.168.1.21', status: 'ONLINE', latencyMs: 34 },
  { id: 3, name: 'Tapo C200 - Patio', ipAddress: '192.168.1.22', status: 'OFFLINE', latencyMs: -1 },
  { id: 4, name: 'Dahua Dome PTZ', ipAddress: '192.168.1.30', status: 'ONLINE', latencyMs: 21 },
];

export const DashboardGrid: React.FC = () => {
  const [cameras, setCameras] = useState<Camera[]>(INITIAL_MOCK);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [simulate, setSimulate] = useState(true);

  useEffect(() => {
    if (!simulate) {
      setCameras([]);
      return;
    }
    setCameras(INITIAL_MOCK);
    const interval = setInterval(() => {
      setCameras((prev) =>
        prev.map((c) => {
          const drop = Math.random() < 0.12;
          return {
            ...c,
            status: drop ? 'OFFLINE' : 'ONLINE',
            latencyMs: drop ? -1 : Math.floor(5 + Math.random() * 60),
          };
        }),
      );
    }, 3000);
    return () => clearInterval(interval);
  }, [simulate]);

  const rescan = async () => {
    setScanning(true);
    await new Promise((r) => setTimeout(r, 1800));
    if (simulate) setCameras(INITIAL_MOCK);
    setScanning(false);
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <main className="flex-1 p-6">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-emerald-400">CCTV Network Sentinel</h1>
          <div className="flex gap-3 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={simulate}
                onChange={(e) => setSimulate(e.target.checked)}
              />
              Modo Simulación
            </label>
            <button
              onClick={rescan}
              disabled={scanning}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 rounded-md text-sm font-semibold"
            >
              {scanning ? 'Escaneando...' : 'Re-escanear'}
            </button>
          </div>
        </header>
        {scanning && (
          <div className="mb-4 text-sm text-amber-400 flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            Escaneando subred 192.168.1.0/24...
          </div>
        )}
        {cameras.length === 0 && !simulate && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
            <p className="text-zinc-300 mb-2">
              No se han detectado cámaras en la red local.
            </p>
            <p className="text-zinc-500 text-sm">
              Haz clic en 'Re-escanear' para buscar dispositivos o activa el 'Modo Simulación' para realizar pruebas.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cameras.map((c) => (
            <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{c.name}</span>
                <span
                  className={`w-3 h-3 rounded-full ${
                    c.status === 'ONLINE' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                  }`}
                />
              </div>
              <p className="text-xs text-zinc-400">{c.ipAddress}</p>
              <p className="text-sm mt-2">
                Latencia: <span className="text-amber-400">{c.latencyMs >= 0 ? c.latencyMs + ' ms' : 'N/A'}</span>
              </p>
            </div>
          ))}
        </div>
      </main>
      <aside
        className={`${panelOpen ? 'w-80' : 'w-0'} transition-all overflow-hidden bg-zinc-900 border-l border-zinc-800`}
      >
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-4 text-amber-400">Alertas Recientes</h2>
          {alerts.map((a) => (
            <div key={a.id} className="mb-3 p-3 bg-zinc-800 rounded-md text-sm">
              <p className="text-zinc-200">{a.message}</p>
              <p className="text-xs text-zinc-500 mt-1">{a.timestamp}</p>
            </div>
          ))}
        </div>
      </aside>
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className="fixed right-0 top-1/2 -translate-y-1/2 bg-zinc-800 px-2 py-4 rounded-l-md"
      >
        {panelOpen ? '›' : '‹'}
      </button>
    </div>
  );
};

export default DashboardGrid;
