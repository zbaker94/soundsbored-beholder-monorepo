# Deploying the TCP-only stack on Railway

Railway does not run `docker-compose.yml` directly — it maps each compose service
to its own Railway service. So you create **three services in one Railway
project**. No third-party service; the SFU is your own `livekit-server` with the
proxy-port bridge (`Dockerfile.livekit` + `entrypoint.sh`).

> Why the bridge: Railway has no UDP and its TCP Proxy assigns a *random* public
> port that isn't the container port. LiveKit must advertise the port clients
> actually reach, so the entrypoint sets `tcp_port`/`node_ip` to Railway's
> `RAILWAY_TCP_PROXY_PORT`/`_DOMAIN` and redirects the container's target port to
> it. See `entrypoint.sh`.

## 1. SFU service (`livekit`)

1. New service → **Deploy from GitHub repo** → this repo.
2. **Build:** Dockerfile path `deploy/tcp/Dockerfile.livekit`, root directory =
   repo root.
3. **Variables:** `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (strong, non-default).
4. **Networking:**
   - **Public HTTP domain** targeting port **7880** → this is the wss signaling
     URL, e.g. `wss://livekit-xxx.up.railway.app` (Railway terminates TLS).
   - **TCP Proxy** targeting port **7881** (the media target). Railway assigns a
     random public port — that's expected; the entrypoint reads it from
     `RAILWAY_TCP_PROXY_PORT`/`RAILWAY_TCP_PROXY_DOMAIN` automatically. **Do not
     override the target port.**
5. Deploy. Check logs for `livekit-bridge: advertising <ip>:<port> (ICE-TCP)`.

## 2. Relay service (`token`)

1. New service → same repo.
2. **Build:** Dockerfile path `packages/relay/Dockerfile`, root = repo root.
3. **Variables:**
   | Variable | Value |
   |----------|-------|
   | `ROOM_PASSWORD` | your shared password |
   | `SFU_URL` | the SFU's public wss domain from step 1 (`wss://livekit-xxx.up.railway.app`) |
   | `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | same values as the SFU |
4. **Networking:** public HTTP domain (port 8080). That URL = your
   **`tokenEndpoint`**. Health check `/healthz`.

## 3. Beholder service (`beholder`)

1. New service → same repo.
2. **Build:** Dockerfile path `packages/listener/Dockerfile`, root = repo root.
3. **Variables:** `LISTENER_TOKEN_ENDPOINT` = the relay's public URL from step 2.
   (Players enter room + password; the endpoint is injected + locked.)
4. **Networking:** public HTTP domain (port 80). That URL is where players listen.

## 4. Wire the consumers

- **App (publisher):** tokenEndpoint = the relay URL, room, password → Go Live.
- **Foundry module:** same tokenEndpoint / room / password (see main
  `docs/DEPLOYMENT.md` §6).
- **Beholder:** open the Beholder URL, enter room + password.

## Notes / caveats

- **TCP-only media** stutters under packet loss (head-of-line blocking). Fine for
  a stable connection / a gate; for best audio use the UDP profile (`deploy/udp`).
- If Railway containers lack `NET_ADMIN`, the entrypoint falls back to a userspace
  **haproxy** bridge automatically — no action needed.
- **Not yet verified on a live Railway deploy.** The mechanism follows Railway's
  documented `RAILWAY_TCP_PROXY_*` vars + LiveKit's ICE rules and the official
  LiveKit template's approach; confirm the bridge log line and a real audio
  connection on your first deploy, and open an issue if a knob needs adjusting.
