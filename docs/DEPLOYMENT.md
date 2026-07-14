# Deployment Guide — SoundsBored Remote Audio

Run the stack somewhere real so remote listeners hear the GM's mix over the
internet. **No third-party service required** — the LiveKit SFU is the
open-source `livekit-server` container you run yourself. You supply only *a host*.

Read [`CONTRACT.md`](../CONTRACT.md) for the wire-level detail (C1–C10); this is
the operational how-to.

---

## 1. What you are deploying

| Component | What it is | Ships in |
|-----------|-----------|----------|
| **Publisher** | The SoundsBored app. Publishes ONE WebRTC audio track (the master mix). | sibling repo `sounds-bored` |
| **SFU** | `livekit-server` — the media server. Receives the one track, forwards a copy to each listener. **This is LiveKit; it is not a separate service and needs no account.** | `livekit/livekit-server` image |
| **Relay (token)** | Fastify `POST /token` + `GET /healthz`. Mints LiveKit JWTs. | `packages/relay` |
| **Consumer** | The **Foundry module** (`soundsbored-audio`) and/or the **Beholder** web listener. | `packages/foundry`, `packages/listener` |

"SFU + relay" together are what the plan calls the **relay**. Everyone —
publisher and every consumer — configures the same three values (Contract C6):

```
tokenEndpoint   the relay's public URL   e.g. https://audio.example.com
room            an agreed string         e.g. world1   (MUST match on all sides)
password        the shared room password (relay ROOM_PASSWORD)
```

---

## 2. The one constraint (why hosting choice matters)

WebRTC has two channels with different needs:

1. **Signaling** (`:7880`, WebSocket) — goes behind a TLS terminator so browsers
   get `wss://`. A normal reverse proxy handles this.
2. **Media** (ICE — UDP `7882` preferred, TCP `7881` fallback) — must be
   **exposed directly on the host**. LiveKit advertises a candidate `IP:port`;
   the client connects to exactly that. It **cannot** sit behind an L4 proxy that
   remaps the port (the advertised port must equal the reachable port).

**Consequence:** the SFU's advertised media port must equal its reachable port. A
VPS / home box with port-forwarding gives this directly (UDP + TCP). A PaaS that
only exposes *remapped* proxy ports (like Railway, which also has no UDP) needs a
startup shim that bridges the assigned proxy port to LiveKit's ICE port and runs
TCP-only — the `deploy/tcp` profile does exactly this (§5).

Browsers on an **http** LAN page can use plain `ws://` (skip TLS). Anything over
the internet from an **https** page needs `wss://` → TLS (§3).

---

## 3. Path A — UDP profile (`deploy/udp`, VPS, recommended)

`deploy/udp/docker-compose.yml` brings up the whole backend — SFU + relay +
Beholder + Caddy (auto-TLS) — in one command. Beholder is served same-origin with
the relay, so listeners enter **only room + password**.

### A1. Prerequisites
- A host with a **public IP** (any small VPS: DigitalOcean, Hetzner, etc.) with
  Docker + Docker Compose.
- A **domain** you control (for TLS). Point two DNS `A` records at the host:
  - `audio.example.com` → host IP
  - `livekit.audio.example.com` → host IP
- Open ports on the host firewall: `80/tcp`, `443/tcp`, `443/udp` (Caddy) and
  `7881/tcp`, `7882/udp` (LiveKit media, direct).

### A2. Configure + launch
```bash
git clone <this repo> && cd soundsbored-remote-audio/deploy/udp
cp .env.example .env
# edit .env:
#   DOMAIN=audio.example.com
#   ROOM_PASSWORD=<a password you distribute>
#   LIVEKIT_API_KEY=<change from devkey>
#   LIVEKIT_API_SECRET=<long random secret, >=32 chars>
docker compose up -d --build
```

What comes up:
- `caddy` — auto-obtains Let's Encrypt certs for both names; routes
  `audio.example.com/token` → relay, `audio.example.com/*` → Beholder,
  `livekit.audio.example.com` → SFU signaling.
- `livekit` — SFU; media published directly on `7881/tcp` + `7882/udp`;
  `use_external_ip` advertises the host IP.
- `token` — relay; `SFU_URL=wss://livekit.audio.example.com`.
- `beholder` — listener; endpoint field hidden (same-origin `/token`).

### A3. Verify the backend
```bash
curl -X POST https://audio.example.com/token \
  -H 'Content-Type: application/json' \
  -d '{"room":"world1","role":"subscriber","password":"YOUR_PASSWORD"}'
# → {"token":"...","url":"wss://livekit.audio.example.com"}
# wrong password → 401 {"error":"bad password"}
```

### A4. Point the pieces at it
- **Publisher (app):** Settings → tokenEndpoint `https://audio.example.com`, room
  `world1`, password → **Go Live**.
- **Beholder listener:** players open `https://audio.example.com`, enter room +
  password, press play.
- **Foundry module:** see §6, tokenEndpoint `https://audio.example.com`.

---

## 4. Path B — Local (`deploy/local`, no TLS, simplest)

Full stack (SFU + relay + Beholder) on your own machine — no TLS, `ws://`/`http`.
Zero-config (dev keys + password `test`):

```bash
cd deploy/local
docker compose up -d --build
docker compose restart livekit    # the reconnect-blip test
```

Values: tokenEndpoint `http://localhost:8080`, Beholder `http://localhost:8081`,
room `world1`, password `test`. For **other machines on your LAN**, edit
`deploy/local/livekit.yaml`'s `node_ip` to this host's LAN IP and use
`http://<lan-ip>:8080` as the tokenEndpoint.

> The older `packages/relay/docker-compose.localhost.yml` harness (relay + SFU
> only, no Beholder) still exists for relay-focused testing; `deploy/local` is the
> full-stack equivalent.

---

## 5. Path C — No-UDP host / Railway (`deploy/tcp`, TCP-only)

For a PaaS without UDP (Railway et al.). All three run there — no SaaS. The SFU
uses a **proxy-port bridge**: the platform's TCP proxy assigns a *random* public
port, so `deploy/tcp/entrypoint.sh` sets LiveKit's advertised ICE port
(`tcp_port`/`node_ip`) to it and redirects the container's target port there
(iptables, haproxy fallback). Built from `deploy/tcp/Dockerfile.livekit`.

- **SFU** — build `deploy/tcp/Dockerfile.livekit`. On Railway: HTTP domain → 7880
  (wss), TCP Proxy → 7881 (media, bridged automatically).
- **Relay** — `packages/relay/Dockerfile`. `SFU_URL` = the SFU's wss domain;
  `ROOM_PASSWORD`, matching `LIVEKIT_API_KEY`/`SECRET`. Its domain = `tokenEndpoint`.
- **Beholder** — `packages/listener/Dockerfile`. `LISTENER_TOKEN_ENDPOINT` = the
  relay's URL (players enter room + password).

**Railway:** each compose service maps to its own Railway service — follow the
exact per-service steps in [`deploy/tcp/RAILWAY.md`](../deploy/tcp/RAILWAY.md).

**Other no-UDP single host:** run `deploy/tcp/docker-compose.yml` and put a TLS
proxy in front (§3-style); set `SFU_EXTERNAL_HOST`/`_TCP_PORT` to the host's proxy.

**Local bridge smoke test:** `cd deploy/tcp && cp .env.example .env && docker
compose up -d --build` — localhost defaults make the bridge a no-op and run the
stack TCP-only (tokenEndpoint `http://localhost:8080`, Beholder `:8081`).

> TCP-only media is the always-works fallback but stutters under packet loss
> (head-of-line blocking) — for best audio use the UDP profile (§3). CONTRACT
> C1/C9's Railway TCP-only SFU is **valid** — this is how it's realized. The
> bridge follows Railway's documented `RAILWAY_TCP_PROXY_*` vars + LiveKit's ICE
> rules; **confirm the `livekit-bridge:` log line + a real audio connection on
> your first Railway deploy.**

---

## 6. Installing + configuring the Foundry module

### 6a. Install — from the manifest URL (needs a published release, §7)
Foundry → **Add-on Modules → Install Module → Manifest URL**:
```
https://github.com/zbaker94/soundsbored-remote-audio/releases/latest/download/module.json
```

### 6b. Install — manual (no release needed, good for the first gate)
```bash
npm run build -w @soundsbored/foundry     # → packages/foundry/dist/
```
Copy the **contents** of `packages/foundry/dist/` into your Foundry data dir at
`Data/modules/soundsbored-audio/` (so `module.json` is at that folder's root).
Restart Foundry.

### 6c. Configure (GM)
1. Enable the module (Foundry v13+).
2. **Game Settings → Configure Settings → SoundsBored Remote Audio** → set
   `tokenEndpoint` (e.g. `https://audio.example.com`), `room` (`world1`),
   `password`. World settings are GM-only to edit, readable by all players (so
   their browsers fetch a subscriber token).

### 6d. Listen (any player)
Click the **headphones** scene control → the panel opens → **Join audio** (the
click unlocks browser playback). Adjust own volume / mute; both persist per
client. The status line rides reconnects automatically.

---

## 7. Publishing a release (for the manifest URL)

`main` holds the merged module. To make §6a work:
```bash
git push origin main
git tag foundry-v0.0.1
git push origin foundry-v0.0.1        # triggers .github/workflows/foundry-release.yml
```
CI builds the module, stamps version + download URL into `module.json`, zips
`dist/`, and attaches `module.json` + `module.zip` to a GitHub Release. Needs the
repo on GitHub — no other service.

---

## 8. Verification / the M4 gate

With the app publishing and a consumer configured:

1. **Audio flows** — a remote player hears the mix.
2. **Own volume** — the player's slider changes only their playback.
3. **Reconnect blip** — restart the SFU mid-stream; audio recovers, pill
   `reconnecting` → `live`:
   `cd deploy/<udp|tcp|local> && docker compose restart livekit`
4. **Status pill** reflects `connecting` / `live` / `reconnecting` / `disconnected`.

### Foundry v13 things to eyeball on the first live run
- The **headphones scene-control** tool appears and opens the panel.
- The panel **renders** (status pill, Join/Leave, volume, mute).
- **Join** starts audio.

---

## 9. Quick reference — who points where

```
Publisher (app) ─┐
                 ├─ tokenEndpoint ─▶ Relay /token ─▶ mints JWT ─▶ SFU (self-hosted livekit-server)
Foundry module ──┤    https://audio.example.com                     wss://livekit.audio.example.com
Beholder web  ───┘    (same-origin for Beholder)                    media: host IP :7882/udp, :7881/tcp
   every side: same room + password ───────────── audio track ──────────────┘
```

- **Path A — UDP (`deploy/udp`):** VPS + Caddy TLS, UDP media. Best audio. §3.
- **Path B — Local (`deploy/local`):** own machine / LAN, plain `http`/`ws`. §4.
- **Path C — TCP (`deploy/tcp`):** no-UDP host / Railway, proxy-port bridge. §5.

See [`deploy/README.md`](../deploy/README.md) for the profile chooser.
