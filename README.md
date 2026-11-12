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
DATABASE_URL=file:./cctv.db
```

Sin token de Telegram las alertas simplemente no se envían.

## Base de datos

Persistencia con SQLite (libSQL) y Drizzle ORM. Las tablas son `cameras`, `health_logs`, `alerts` y `users`.

- El servidor aplica automáticamente las migraciones de `packages/db/migrations` al arrancar.
- Por defecto la base de datos se crea como `apps/server/cctv.db` (ignorada por Git).
- Cambia la ubicación con `DATABASE_URL`, por ejemplo `file:../../data/cctv.db`.

```bash
npm run db:generate   # genera una migración tras cambiar el esquema
npm run db:studio     # abre Drizzle Studio
```

Al añadir una migración nueva, reinicia el servidor para aplicarla.

## API actual

| Método | Ruta                 | Descripción                                      |
| ------ | -------------------- | ------------------------------------------------ |
| GET    | `/health`            | Estado del servidor                              |
| GET    | `/api/cameras`       | Lista de cámaras persistidas                     |
| GET    | `/api/alerts`        | Últimas 200 alertas                              |
| GET    | `/api/history`       | Últimos 200 heartbeats                           |
| GET    | `/api/scan/status`   | Indica si hay un escaneo en curso                |
| POST   | `/api/scan`          | Escanea `{ "subnet": "192.168.1" }` y actualiza cámaras |
| POST   | `/heartbeat`         | Registra estado de una cámara                    |

El escaneo comprueba RTSP (554) y HTTP (80, 443, 8000, 8080) en los 254 hosts de la subred /24.

## Variables del dashboard

- `VITE_API_URL`: URL de la API (por defecto `http://localhost:3000`).

## Limitaciones conocidas

- Las alertas de Telegram están implementadas; falta el envío a webhooks genéricos.
- No hay autenticación ni tests automatizados.
