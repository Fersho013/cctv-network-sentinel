import React, { useCallback, useEffect, useState } from 'react';
import { liveUrl, startLive, type Camera, type StreamInfo } from '../api';
import VideoPlayer from './VideoPlayer';

interface LiveViewProps {
  camera: Camera;
  onClose: () => void;
}

export const LiveView: React.FC<LiveViewProps> = ({ camera, onClose }) => {
  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const response = await startLive(camera.id);
      setInfo(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [camera.id]);

  useEffect(() => {
    void start();
  }, [start]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-zinc-100">{camera.name}</h2>
            <p className="text-xs text-zinc-400">
              {camera.ipAddress} · {camera.brand}
              {info ? ` · ${info.mode === 'transcode' ? 'transcodificado' : 'directo'}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Cerrar ✕
          </button>
        </div>

        <div className="flex-1 bg-black">
          {loading && (
            <div className="flex h-[60vh] items-center justify-center gap-3 text-sm text-amber-300">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
              Iniciando vídeo en vivo…
            </div>
          )}

          {!loading && error && (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
              <p className="max-w-xl text-sm text-red-300">{error}</p>
              <button
                onClick={() => void start()}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Reintentar
              </button>
            </div>
          )}

          {!loading && !error && info && (
            <VideoPlayer src={liveUrl(info.hlsUrl)} className="h-[60vh] w-full" />
          )}
        </div>

        <div className="border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
          RTSP · {camera.streamPath || 'ruta por defecto'} · puerto {camera.rtspPort}
        </div>
      </div>
    </div>
  );
};

export default LiveView;
