import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import Constants from 'expo-constants';
import { registerRootComponent } from 'expo';
import '../global.css';

interface Camera {
  id: number;
  name: string;
  brand: string;
  ipAddress: string;
  status: 'ONLINE' | 'OFFLINE';
  latencyMs: number;
  hasPassword: boolean;
  streaming: boolean;
}

interface Alert {
  id: number;
  message: string;
  severity: string;
}

function defaultServer(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
      ?.debuggerHost;
  const host = hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

export default function HomeScreen() {
  const [server, setServer] = useState(defaultServer());
  const [serverInput, setServerInput] = useState(defaultServer());
  const [loading, setLoading] = useState(true);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [liveCamera, setLiveCamera] = useState<Camera | null>(null);
  const [liveUri, setLiveUri] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [tick, setTick] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [camerasResponse, alertsResponse] = await Promise.all([
        fetch(`${server}/api/cameras`).then((response) => response.json()),
        fetch(`${server}/api/alerts`).then((response) => response.json()),
      ]);
      setCameras(camerasResponse as Camera[]);
      setAlerts(alertsResponse as Alert[]);
      setTick(Date.now());
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [server]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, [load]);

  const credentialsReady = useMemo(
    () => cameras.some((camera) => camera.hasPassword),
    [cameras],
  );

  const openLive = async (camera: Camera) => {
    setLiveCamera(camera);
    setLiveUri(null);
    setLiveError(null);
    setLiveLoading(true);

    try {
      const response = await fetch(`${server}/api/cameras/${camera.id}/live`);
      const body = (await response.json()) as { hlsUrl?: string; error?: string };

      if (!response.ok || !body.hlsUrl) {
        setLiveError(body.error ?? 'No se pudo iniciar el vídeo.');
        return;
      }

      setLiveUri(body.hlsUrl.startsWith('http') ? body.hlsUrl : `${server}${body.hlsUrl}`);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : String(error));
    } finally {
      setLiveLoading(false);
    }
  };

  const closeLive = () => {
    setLiveCamera(null);
    setLiveUri(null);
    setLiveError(null);
  };

  const online = cameras.filter((camera) => camera.status === 'ONLINE').length;
  const offline = cameras.length - online;
  const avgLatency =
    cameras.filter((camera) => camera.latencyMs > 0).reduce((total, camera) => total + camera.latencyMs, 0) /
    (online || 1);

  if (loading) return <ActivityIndicator size="large" color="#22c55e" className="mt-10" />;

  return (
    <ScrollView className="flex-1 bg-zinc-950 p-4">
      <Text className="text-xl font-bold text-emerald-400 mb-1">CCTV Sentinel Mobile</Text>
      <Text className="text-xs text-zinc-500 mb-3">Vigilancia en tu red local</Text>

      <View className="bg-zinc-900 p-3 rounded-md mb-4">
        <Text className="text-zinc-400 text-xs mb-1">Servidor</Text>
        <View className="flex-row gap-2">
          <TextInput
            value={serverInput}
            onChangeText={setServerInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://192.168.1.92:3000"
            placeholderTextColor="#71717a"
            className="flex-1 bg-zinc-950 text-zinc-100 px-3 py-2 rounded-md border border-zinc-700"
          />
          <Pressable
            onPress={() => {
              const next = serverInput.trim().replace(/\/+$/, '');
              setServer(next);
              setLoading(true);
            }}
            className="bg-emerald-600 px-3 py-2 rounded-md justify-center"
          >
            <Text className="text-white font-semibold">Conectar</Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-row gap-2 mb-4">
        <View className="flex-1 bg-zinc-900 p-3 rounded-md">
          <Text className="text-zinc-400 text-xs">Online</Text>
          <Text className="text-emerald-400 text-xl font-bold">{online}</Text>
        </View>
        <View className="flex-1 bg-zinc-900 p-3 rounded-md">
          <Text className="text-zinc-400 text-xs">Offline</Text>
          <Text className="text-red-400 text-xl font-bold">{offline}</Text>
        </View>
        <View className="flex-1 bg-zinc-900 p-3 rounded-md">
          <Text className="text-zinc-400 text-xs">Latencia avg</Text>
          <Text className="text-amber-400 text-xl font-bold">{avgLatency.toFixed(0)}ms</Text>
        </View>
      </View>

      {!credentialsReady && cameras.length > 0 && (
        <View className="bg-amber-950/40 border border-amber-800 p-3 rounded-md mb-4">
          <Text className="text-amber-300 text-xs">
            Configura usuario y contraseña de cámara desde la app de escritorio para ver el vídeo.
          </Text>
        </View>
      )}

      {cameras.length === 0 && (
        <View className="bg-zinc-900 p-4 rounded-md mb-4">
          <Text className="text-zinc-300">No hay cámaras registradas.</Text>
          <Text className="text-zinc-500 text-xs mt-1">
            Añádelas desde la app de escritorio o pulsa «Escanear red» allí.
          </Text>
        </View>
      )}

      <View className="flex-row flex-wrap -mx-1">
        {cameras.map((camera) => (
          <View key={camera.id} className="w-1/2 px-1 mb-2">
            <View className="bg-zinc-900 rounded-md overflow-hidden">
              {camera.hasPassword ? (
                <Image
                  source={{ uri: `${server}/api/cameras/${camera.id}/snapshot?t=${tick}` }}
                  className="w-full aspect-video bg-black"
                  resizeMode="cover"
                />
              ) : (
                <View className="w-full aspect-video bg-black items-center justify-center">
                  <Text className="text-zinc-600 text-2xl">📷</Text>
                </View>
              )}

              <View className="p-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-zinc-200 text-sm flex-1" numberOfLines={1}>
                    {camera.name}
                  </Text>
                  <View
                    className={`w-2.5 h-2.5 rounded-full ml-1 ${
                      camera.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                  />
                </View>
                <Text className="text-zinc-500 text-[10px] mt-0.5">{camera.ipAddress}</Text>

                <Pressable
                  onPress={() => void openLive(camera)}
                  className="bg-emerald-600 rounded-md px-2 py-1.5 mt-2"
                >
                  <Text className="text-white text-xs font-semibold text-center">Ver en vivo</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
      </View>

      <Text className="text-amber-400 mb-2 mt-2">Alertas activas: {alerts.length}</Text>
      {alerts.map((alert) => (
        <View key={alert.id} className="bg-zinc-900 p-3 rounded-md mb-2">
          <Text className="text-zinc-200">{alert.message}</Text>
          <Text className="text-zinc-500 text-xs">{alert.severity}</Text>
        </View>
      ))}

      <Modal visible={liveCamera !== null} animationType="slide" onRequestClose={closeLive}>
        <View className="flex-1 bg-black">
          <View className="flex-row items-center justify-between px-4 py-3 bg-zinc-900">
            <View className="flex-1">
              <Text className="text-zinc-100 font-semibold">{liveCamera?.name}</Text>
              <Text className="text-zinc-500 text-xs">{liveCamera?.ipAddress}</Text>
            </View>
            <Pressable onPress={closeLive} className="px-3 py-1">
              <Text className="text-zinc-300">Cerrar ✕</Text>
            </Pressable>
          </View>

          <View className="flex-1 items-center justify-center">
            {liveLoading && <ActivityIndicator size="large" color="#22c55e" />}
            {!liveLoading && liveError && (
              <Text className="text-red-300 text-sm px-6 text-center">{liveError}</Text>
            )}
            {!liveLoading && liveUri && (
              <Video
                source={{ uri: liveUri }}
                useNativeControls
                shouldPlay
                isMuted={false}
                resizeMode={ResizeMode.CONTAIN}
                className="w-full"
                style={{ width: '100%', height: '100%' }}
                onError={(message) => setLiveError(message)}
              />
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

registerRootComponent(HomeScreen);
