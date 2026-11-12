# CCTV Network Sentinel

Centro local de videovigilancia para tu red: descubre cámaras IP, guarda su estado online/offline y **ve el vídeo en directo desde el navegador, la app de escritorio o el móvil**. Todo se procesa en tu LAN; no se sube vídeo a Internet.

- Escaneo de subred con detección de RTSP (554) y HTTP (80, 443, 8000, 8080).
- Estado online/offline, latencia, historial y alertas (Telegram).
- Vídeo en vivo vía RTSP → HLS con FFmpeg, compatible con navegador, Tauri y Expo.
- Credenciales de cámara cifradas con AES-256-GCM en SQLite.
- Presets para Tapo, Hikvision, Dahua, Reolink, Amcrest, Axis y cámaras genéricas.
- Captura de miniaturas y comprobación de conexión por cámara.

## Estructura

```
apps/
  desktop/   Dashboard React + Vite (empaquetable con Tauri)
  mobile/    App Expo / React Native + NativeWind
  server/    API Fastify + gateway RTSP/HLS con FFmpeg
packages/
  core/      Lógica de escaneo de red
  db/        Esquema Drizzle + cliente SQLite (libSQL)
```

## Requisitos

- Node.js >= 18 (probado con Node 24)
- npm >= 9
- **FFmpeg** (incluye `ffprobe`) para el vídeo en vivo.

### Instalar FFmpeg en Windows

```powershell
winget install --id Gyan.FFmpeg -e
```

El servidor busca FFmpeg en este orden: `FFMPEG_PATH`, la carpeta de WinGet, y el `PATH`. También puedes descargarlo desde <https://ffmpeg.org/download.html> y definir `FFMPEG_PATH` en `apps/server/.env`.

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

En el móvil, el servidor se configura desde el propio campo «Servidor» (por defecto intenta usar la IP de la máquina que ejecuta Expo, puerto 3000).

## Calidad

```bash
npm run typecheck     # TypeScript en todos los workspaces
npm run build         # Build de todos los workspaces
npm run lint          # ESLint
npm run format        # Prettier
```

## Configuración

Copia `.env.example` a `.env` en `apps/server/` (o en la raíz) y define:

```ini
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
PORT=3000
DATABASE_URL=file:./cctv.db
# FFMPEG_PATH=C:\ruta\a\ffmpeg.exe
# CREDENTIALS_KEY=
# HEALTH_INTERVAL_MS=30000
# WEBHOOK_URL=https://example.com/hooks/cctv
# WEBHOOK_SECRET=change-me
```

- Sin token de Telegram las alertas simplemente no se envían.
- `WEBHOOK_URL` acepta una o varias URLs separadas por comas. Se envían al crear cada alerta.
- `WEBHOOK_SECRET` firma el cuerpo con HMAC-SHA256 en la cabecera `X-CCTV-Signature: sha256=...`.
- `CREDENTIALS_KEY` debe tener 32 bytes (64 caracteres hex o base64). Si se omite, el servidor genera `.credentials-key` junto a su carpeta de trabajo; **conserva ese archivo** o perderás las contraseñas guardadas.
- `VITE_API_URL` en el dashboard permite apuntar a otra IP/puerto de API (por defecto `http://localhost:3000`).

## Conectar una TP-Link Tapo (C200C y similares)

RTSP viene desactivado por defecto y no se usa la cuenta de TP-Link.

1. Abre la app **Tapo** → tu cámara → engranaje → **Configuración avanzada** → **Cuenta de cámara**.
2. Crea un usuario y contraseña (son independientes de tu cuenta Tapo). Anótalos.
3. Averigua la IP: app Tapo → cámara → engranaje → **Información del dispositivo** → **Dirección IP**. También aparece en la lista DHCP de tu router.
4. En el dashboard pulsa **+ Añadir cámara**:
   - Marca: **TP-Link Tapo**
   - IP: la del paso 3
   - Usuario/contraseña: los de la cuenta de cámara
   - Ruta: `/stream1` (alta calidad) o `/stream2` (baja calidad)
5. Pulsa **Probar conexión**. Debe mostrar códec, resolución y FPS.
6. Guarda y pulsa **Ver en vivo**.

Si la prueba falla con «puerto 554 no responde», revisa que la cámara esté encendida, en la misma red y que la cuenta de cámara esté creada.

## Cómo funciona el vídeo

1. El servidor construye la URL RTSP con las credenciales descifradas en memoria.
2. FFmpeg lee el flujo por TCP y genera segmentos HLS de ~1 s en la carpeta temporal del sistema.
3. El navegador/móvil reproduce el HLS con `hls.js` (escritorio) o el reproductor nativo (Expo).
4. Si el códec no es H.264, el servidor reintenta automáticamente transcodificando a H.264.
5. Las sesiones se detienen solas tras 60 s sin peticiones de segmentos.

Las credenciales nunca se envían al cliente y la contraseña se muestra siempre enmascarada.

## Base de datos

Persistencia con SQLite (libSQL) y Drizzle ORM. Las tablas son `cameras`, `health_logs`, `alerts` y `users`.

- El servidor aplica automáticamente las migraciones de `packages/db/migrations` al arrancar.
- Por defecto la base de datos se crea como `apps/server/cctv.db` (ignorada por Git).
- Cambia la ubicación con `DATABASE_URL`, por ejemplo `file:../../data/cctv.db`.

```bash
npm run db:generate   # genera una migración tras cambiar el esquema
npm run db:studio     # abre Drizzle Studio
```

## API

| Método | Ruta                           | Descripción                                              |
| ------ | ------------------------------ | -------------------------------------------------------- |
| GET    | `/health`                      | Estado del servidor y rutas de FFmpeg/FFprobe            |
| GET    | `/api/camera-presets`          | Presets RTSP por marca                                   |
| GET    | `/api/cameras`                 | Lista de cámaras (sin contraseñas)                       |
| POST   | `/api/cameras`                 | Crea una cámara con credenciales cifradas                |
| PATCH  | `/api/cameras/:id`             | Edita una cámara (contraseña opcional)                   |
| DELETE | `/api/cameras/:id`             | Elimina una cámara y detiene su stream                   |
| POST   | `/api/cameras/test`            | Comprueba RTSP y devuelve códec/resolución               |
| GET    | `/api/cameras/:id/live`        | Inicia el stream y devuelve la URL HLS                   |
| POST   | `/api/cameras/:id/stream/stop` | Detiene el stream                                        |
| GET    | `/api/cameras/:id/snapshot`    | Última imagen JPEG (caché de 4 s)                        |
| GET    | `/streams/:id/index.m3u8`      | Playlist HLS y segmentos                                 |
| GET    | `/api/alerts`                  | Últimas 200 alertas                                      |
| GET    | `/api/webhooks/status`         | Webhooks configurados (URLs enmascaradas)                |
| POST   | `/api/webhooks/test`           | Envía un webhook de prueba                               |
| GET    | `/api/history`                 | Últimos 200 heartbeats                                   |
| GET    | `/api/scan/status`             | Indica si hay un escaneo en curso                        |
| POST   | `/api/scan`                    | Escanea `{ "subnet": "192.168.1" }` y actualiza cámaras  |
| POST   | `/heartbeat`                   | Registra estado de una cámara                            |

Ejemplo de alta:

```bash
curl -X POST http://localhost:3000/api/cameras \
  -H "Content-Type: application/json" \
  -d '{"name":"Entrada","brand":"tapo","ipAddress":"192.168.1.50","username":"camuser","password":"secreto","channel":1}'
```

## Webhooks

Cuando se crea una alerta (cámara offline, recuperada, etc.) el servidor envía un `POST` JSON a cada `WEBHOOK_URL`:

```json
{
  "event": "camera.offline",
  "message": "Cámara OFFLINE: Entrada (192.168.1.50)",
  "severity": "warning",
  "timestamp": "2026-11-12T08:00:00.000Z",
  "alertId": 12,
  "camera": {
    "id": 3,
    "name": "Entrada",
    "brand": "tapo",
    "ipAddress": "192.168.1.50",
    "status": "OFFLINE"
  }
}
```

- Eventos: `camera.offline`, `camera.online`, `alert`.
- Hasta 3 intentos con espera exponencial (500 ms, 1 s). Los 4xx no se reintentan.
- Firma opcional: `X-CCTV-Signature: sha256=<hmac>` calculada sobre el cuerpo exacto con `WEBHOOK_SECRET`.
- Comprueba la configuración con `GET /api/webhooks/status` y prueba el envío con `POST /api/webhooks/test`.

## Limitaciones conocidas

- El vídeo requiere FFmpeg instalado; sin él, el estado online/offline sigue funcionando.
- Las URLs RTSP usan TCP; algunas cámaras antiguas solo soportan UDP.
- No hay autenticación ni TLS: pensado para LAN de confianza.
- La reproducción en navegador usa HLS (latencia ~1-3 s). Para latencia menor se puede añadir WebRTC con go2rtc.
- Los webhooks no se guardan en la base de datos: se configuran por entorno.
