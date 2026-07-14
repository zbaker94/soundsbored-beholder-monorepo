# @soundsbored/relay

LiveKit token mint service for SoundsBored remote audio.

## Endpoints

- `POST /token` — mint a LiveKit JWT (see [CONTRACT.md](../../CONTRACT.md) C4)
- `GET /healthz` — health check (Railway, Docker probes)

## Environment Variables

| Variable              | Required | Default               |
|-----------------------|----------|-----------------------|
| `ROOM_PASSWORD`       | **Yes**  | —                     |
| `PORT`                | No       | `8080`                |
| `LIVEKIT_API_KEY`     | No       | `devkey`              |
| `LIVEKIT_API_SECRET`  | No       | `secret`              |
| `SFU_URL`             | No       | `ws://localhost:7880` |

## Self-Host (Docker Compose)

```bash
export ROOM_PASSWORD=your-secret-password
docker compose up
```

LiveKit SFU + token service will start. Ports exposed:
- `7880` — LiveKit signaling (ws)
- `7881` — LiveKit media TCP
- `7882/udp` — LiveKit media UDP
- `8080` — Token service HTTP

LiveKit config used: `livekit.selfhost.yaml` (UDP 7882 mux).

## Railway Deploy

1. Create a new Railway service from this repo (Dockerfile at `packages/relay/Dockerfile`).
2. Set env vars: `ROOM_PASSWORD`, `SFU_URL` (your LiveKit Cloud URL), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
3. Railway sets `PORT` automatically — the service reads it.
4. Add a healthcheck on `GET /healthz`.

LiveKit Cloud provides the SFU — use `livekit.railway.yaml` for a self-hosted SFU on Railway (TCP only, no UDP).

## Local Dev

```bash
cd ../../
npm install
ROOM_PASSWORD=test npm -w @soundsbored/relay test
```
