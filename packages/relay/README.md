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

## Local host-browser harness (M2/M3 verify)

TCP-only LiveKit advertising `127.0.0.1` so a host browser reaches ICE candidates
(`livekit.localdev.yaml`). Run LiveKit in Docker; run the relay + listener on the host.

```bash
# 1. LiveKit only, detached
docker compose -f packages/relay/docker-compose.localdev.yml up -d
# 2. Relay token endpoint (from repo root)
npm -w @soundsbored/relay run build
ROOM_PASSWORD=test SFU_URL=ws://localhost:7880 node packages/relay/dist/index.js
# 3. Standalone listener
npm -w @soundsbored/listener run dev
```

Publisher is the SoundsBored app (`npm run tauri dev` → Go Live, room `spike`).
Until M3 the app still pastes a hand-minted PUB token; after the C4 swap it fetches
one from this endpoint.

### Fully-dockerized localhost (relay in Docker too)

Same host-browser reachability, but the relay runs in Docker as well — layer
`docker-compose.localhost.yml` over the base stack. This is the one-command
localhost backend for M3/M4/M5 verification.

```powershell
# PowerShell (no inline VAR=val; curl is Invoke-WebRequest, use Invoke-RestMethod)
$env:ROOM_PASSWORD="test"
docker compose -f docker-compose.yml -f docker-compose.localhost.yml up -d --build
# optional: make the two -f implicit for restart/down (';' = Windows path sep)
$env:COMPOSE_FILE="docker-compose.yml;docker-compose.localhost.yml"
docker compose restart livekit   # the reconnect-blip test
docker compose down
```

Then: listener `npm -w @soundsbored/listener run dev` (:5173); app Go Live with
`http://localhost:8080` / `world1` / `test`.

> **Why the override exists:** `docker-compose.yml` alone uses `livekit.selfhost.yaml`
> (`use_external_ip`, UDP) whose ICE candidates a host browser can't reach, and it
> defaults `SFU_URL` to the docker-internal `ws://livekit:7880`. The override swaps in
> `livekit.localdev.yaml` (TCP-only loopback) and pins `SFU_URL=ws://localhost:7880`.
> (The `SFU_URL` default in the table above is the app default; the base compose file
> overrides it to `ws://livekit:7880`.)

