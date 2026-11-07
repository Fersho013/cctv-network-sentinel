import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';

const SERVER = 'http://localhost:3000';

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [cameras, setCameras] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${SERVER}/health`)
      .then(() => {
        setCameras([
          { id: 1, name: 'DVR Hikvision', status: 'ONLINE', latency: 12 },
          { id: 2, name: 'Tapo C200', status: 'OFFLINE', latency: -1 },
        ]);
        setAlerts([{ id: 1, message: 'Tapo C200 desconectada', severity: 'warning' }]);
      })
      .finally(() => setLoading(false));
  }, []);

  const online = cameras.filter((c) => c.status === 'ONLINE').length;
  const offline = cameras.length - online;
  const avgLatency = cameras.filter((c) => c.latency > 0).reduce((a, b) => a + b.latency, 0) / (online || 1);

  if (loading) return <ActivityIndicator size="large" color="#22c55e" className="mt-10" />;

  return (
    <ScrollView className="flex-1 bg-zinc-950 p-4">
      <Text className="text-xl font-bold text-emerald-400 mb-4">CCTV Sentinel Mobile</Text>
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
      <Text className="text-amber-400 mb-2">Alertas activas: {alerts.length}</Text>
      {alerts.map((a) => (
        <View key={a.id} className="bg-zinc-900 p-3 rounded-md mb-2">
          <Text className="text-zinc-200">{a.message}</Text>
          <Text className="text-zinc-500 text-xs">{a.severity}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
