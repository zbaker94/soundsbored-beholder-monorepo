# SoundsBored Remote Audio — Shared Contract

## C1 SFU URL / Ports

- Signaling: `7880` (ws/wss)
- Media: `7881/TCP` (Railway) or `7882/UDP` (self-host)

## C2 Room Identity

- A room name is an arbitrary non-empty string chosen by the publisher.
- Participants join the same room by name.

## C3 Token Grants

- **publisher**: `{ roomJoin: true, room, canPublish: true, canSubscribe: false }`
- **subscriber**: `{ roomJoin: true, room, canPublish: false, canSubscribe: true }`

## C4 Token Endpoint

```
POST /token   Content-Type: application/json
Body: { room: string, role: 'publisher' | 'subscriber', password: string }

200 → { token: string, url: string }   // url = SFU ws/wss URL (env SFU_URL)
401 → { error: 'bad password' }
400 → { error: 'bad request' }
```

- Password checked against env `ROOM_PASSWORD`.
- Role → grant per C3.
- `url` = env `SFU_URL`.
- CORS: `Access-Control-Allow-Origin: *`, methods POST + OPTIONS, `Content-Type` header.
- LiveKit credentials from env `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.
  - Dev defaults: `devkey` / `secret`.

## C5 Environment Variables (relay)

| Variable            | Required | Default             | Notes                        |
|---------------------|----------|---------------------|------------------------------|
| `PORT`              | No       | `8080`              | HTTP listen port             |
| `LIVEKIT_API_KEY`   | No       | `devkey`            | LiveKit API key              |
| `LIVEKIT_API_SECRET`| No       | `secret`            | LiveKit API secret           |
| `ROOM_PASSWORD`     | **Yes**  | —                   | Shared room password; exit 1 if unset |
| `SFU_URL`           | No       | `ws://localhost:7880` | WebSocket URL for LiveKit SFU |

## C6 LiveKit Config

- Self-host: UDP port 7882, `use_external_ip: true`
- Railway: TCP port 7881, `use_external_ip: true`, no UDP

## C7 Docker / Deployment

- `livekit-server` + `token` service via `docker-compose.yml` (self-host).
- Railway: deploy `token` service, point `SFU_URL` at LiveKit Cloud or separate instance.
