import React, { useState } from 'react';
import {
  createCamera,
  testCamera,
  updateCamera,
  type Camera,
  type CameraPreset,
  type TestResult,
} from '../api';

interface CameraFormProps {
  camera: Camera | null;
  presets: CameraPreset[];
  onClose: () => void;
  onSaved: () => void;
}

export const CameraForm: React.FC<CameraFormProps> = ({ camera, presets, onClose, onSaved }) => {
  const editing = camera !== null;
  const initialPreset =
    presets.find((preset) => preset.id === camera?.brand) ??
    presets.find((preset) => preset.id === 'tapo') ??
    presets[0];

  const [name, setName] = useState(camera?.name ?? '');
  const [brand, setBrand] = useState(camera?.brand ?? initialPreset?.id ?? 'generic');
  const [ipAddress, setIpAddress] = useState(camera?.ipAddress ?? '');
  const [rtspPort, setRtspPort] = useState(String(camera?.rtspPort ?? initialPreset?.rtspPort ?? 554));
  const [channel, setChannel] = useState(String(camera?.channel ?? 1));
  const [username, setUsername] = useState(camera?.username ?? '');
  const [password, setPassword] = useState('');
  const [streamPath, setStreamPath] = useState(camera?.streamPath ?? initialPreset?.streamPath ?? '/stream1');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preset = presets.find((item) => item.id === brand);

  const changeBrand = (nextBrand: string) => {
    setBrand(nextBrand);
    const nextPreset = presets.find((item) => item.id === nextBrand);
    if (nextPreset) {
      setRtspPort(String(nextPreset.rtspPort));
      setStreamPath(nextPreset.streamPath);
    }
    setResult(null);
  };

  const formInput = () => ({
    name: name.trim(),
    brand,
    ipAddress: ipAddress.trim(),
    rtspPort: Number(rtspPort) || 554,
    channel: Number(channel) || 1,
    username: username.trim(),
    streamPath: streamPath.trim(),
    ...(password ? { password } : {}),
  });

  const runTest = async () => {
    setTesting(true);
    setError(null);
    setResult(null);

    try {
      const response = await testCamera({
        ...formInput(),
        ...(editing && camera ? { cameraId: camera.id } : {}),
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (editing && camera) {
        const input = formInput();
        const { name: nextName, ...rest } = input;
        await updateCamera(camera.id, { ...rest, name: nextName });
      } else {
        await createCamera(formInput());
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500';
  const labelClass = 'flex flex-col gap-1 text-xs uppercase tracking-wide text-zinc-400';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <form
        onSubmit={save}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-emerald-400">
              {editing ? 'Editar cámara' : 'Añadir cámara'}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Los datos se guardan cifrados en el servidor local.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Nombre
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Cámara entrada"
              required
              className={fieldClass}
            />
          </label>

          <label className={labelClass}>
            Marca
            <select
              value={brand}
              onChange={(event) => changeBrand(event.target.value)}
              className={fieldClass}
            >
              {presets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Dirección IP
            <input
              value={ipAddress}
              onChange={(event) => setIpAddress(event.target.value)}
              placeholder="192.168.1.50"
              required
              className={fieldClass}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Puerto RTSP
              <input
                value={rtspPort}
                onChange={(event) => setRtspPort(event.target.value)}
                inputMode="numeric"
                className={fieldClass}
              />
            </label>
            <label className={labelClass}>
              Canal
              <input
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                inputMode="numeric"
                className={fieldClass}
              />
            </label>
          </div>

          <label className={labelClass}>
            Usuario de cámara
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="cuenta de cámara"
              className={fieldClass}
            />
          </label>

          <label className={labelClass}>
            Contraseña {editing && <span className="normal-case text-zinc-500">(vacío = sin cambios)</span>}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={editing ? '••••••••' : 'contraseña'}
              className={fieldClass}
            />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Ruta RTSP
            <input
              value={streamPath}
              onChange={(event) => setStreamPath(event.target.value)}
              placeholder="/stream1"
              className={`${fieldClass} font-mono`}
            />
            <span className="normal-case text-zinc-500">
              Puedes indicar una URL completa o solo la ruta. {preset?.notes ?? ''}
            </span>
          </label>
        </div>

        {result && (
          <div
            className={`mt-4 rounded-md border px-4 py-3 text-sm ${
              result.ok
                ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
                : 'border-red-800 bg-red-950/40 text-red-300'
            }`}
          >
            {result.ok ? (
              <>
                Conexión correcta · {result.codec?.toUpperCase()}
                {result.width && result.height ? ` · ${result.width}×${result.height}` : ''}
                {result.fps ? ` · ${result.fps} fps` : ''}
              </>
            ) : (
              result.error ?? 'La cámara no respondió.'
            )}
            <p className="mt-1 break-all text-xs opacity-70">{result.url}</p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={runTest}
            disabled={testing || !ipAddress}
            className="rounded-md border border-zinc-600 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar cámara'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CameraForm;
