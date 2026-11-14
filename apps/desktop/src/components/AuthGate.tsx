import React, { useCallback, useEffect, useState } from 'react';
import { authStatus, login, onUnauthorized } from '../api';
import DashboardGrid from './DashboardGrid';

type Phase = 'checking' | 'login' | 'ready' | 'offline';

export default function AuthGate() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const status = await authStatus();
      setPhase(status.authenticated ? 'ready' : 'login');
    } catch {
      setPhase('offline');
    }
  }, []);

  useEffect(() => {
    void check();
    onUnauthorized(() => {
      setPin('');
      setError('La sesión expiró. Introduce el PIN de nuevo.');
      setPhase('login');
    });
  }, [check]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pin.trim() || busy) return;

    setBusy(true);
    setError(null);
    try {
      await login(pin.trim());
      setPin('');
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'ready') return <DashboardGrid />;

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-lg font-bold text-emerald-400">CCTV Network Sentinel</h1>
        <p className="mt-1 text-xs text-zinc-500">
          {phase === 'offline'
            ? 'No se pudo contactar con el servidor.'
            : 'Introduce el PIN de acceso configurado en el servidor.'}
        </p>

        {phase === 'checking' && (
          <p className="mt-6 text-sm text-zinc-400">Comprobando sesión...</p>
        )}

        {phase === 'offline' && (
          <div className="mt-6 space-y-3">
            <p className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              Revisa que el servidor esté arrancado (npm run dev:server) y que la URL de la API sea
              correcta.
            </p>
            <button
              onClick={() => {
                setPhase('checking');
                void check();
              }}
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Reintentar
            </button>
          </div>
        )}

        {phase === 'login' && (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <label className="block text-xs uppercase tracking-wide text-zinc-400">
              PIN
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="••••••"
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-center text-lg tracking-[0.4em] text-zinc-100 outline-none focus:border-emerald-500"
              />
            </label>

            {error && (
              <p className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !pin.trim()}
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {busy ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
