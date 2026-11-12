# CCTV Network Sentinel

Monorepo para monitorizar cámaras CCTV en red local: escaneo de subred, estado online/offline, latencia, historial y alertas (Telegram).

## Estructura

```
apps/
  desktop/   Dashboard React + Vite (empaquetable con Tauri)
  mobile/    App Expo / React Native + NativeWind
  server/    API Fastify (heartbeat, cámaras, alertas, historial)
packages/
  core/      Lógica de escaneo de red
  db/        Esquema Drizzle + cliente SQLite (libSQL)
```

## Requisitos

- Node.js >= 18 (probado con Node 24)
- npm >= 9

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev:server    # API en http://localhost:3000
npm run dev:desktop   # Dashboard en http://localhost:5173
npm run dev:mobile    # Expo
```

## Calidad

```bash
npm run typecheck     # TypeScript en todos los workspaces
npm run build         # Build de todos los workspaces
npm run lint          # ESLint
npm run format        # Prettier
```

## Configuración

Copia `.env.example` a `.env` en `apps/server/` (o en la raíz) y define:

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
PORT=3000
```

Sin token de Telegram las alertas simplemente no se envían.

## API actual

| Método | Ruta                 | Descripción                                      |
| ------ | -------------------- | ------------------------------------------------ |
| GET    | `/health`            | Estado del servidor                              |
| GET    | `/api/cameras`       | Lista de cámaras (en memoria)                    |
| GET    | `/api/alerts`        | Alertas (en memoria)                             |
| GET    | `/api/history`       | Historial de heartbeats (en memoria)             |
| GET    | `/api/scan/status`   | Indica si hay un escaneo en curso                |
| POST   | `/api/scan`          | Escanea `{ "subnet": "192.168.1" }` y actualiza cámaras |
| POST   | `/heartbeat`         | Registra estado de una cámara                    |

El escaneo comprueba RTSP (554) y HTTP (80, 443, 8000, 8080) en los 254 hosts de la subred /24.

## Variables del dashboard

- `VITE_API_URL`: URL de la API (por defecto `http://localhost:3000`).

## Limitaciones conocidas

- El servidor guarda cámaras, alertas e historial en memoria; el esquema Drizzle de `packages/db` todavía no se usa ni hay migraciones.
- El commit de webhooks solo incluye alertas por Telegram; falta el envío a webhooks.
- No hay autenticación ni tests automatizados.
