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

**Consequence:** you need a host where you can open the media ports directly. A
VPS or a home box with port-forwarding works. A PaaS that only exposes remapped
proxy ports (Railway) can host the token endpoint + Beholder but **not** the SFU
media — see §5.

Browsers on an **http** LAN page can use plain `ws://` (skip TLS). Anything over
the internet from an **https** page needs `wss://` → TLS (§3).

---

## 3. Path A — One-stack self-host on a VPS (recommended)

`deploy/docker-compose.yml` brings up the whole backend — SFU + relay + Beholder
+ Caddy (auto-TLS) — in one command. Beholder is served same-origin with the
relay, so listeners enter **only room + password**.

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
git clone <this repo> && cd soundsbored-remote-audio/deploy
cp .env.example .env
# edit .env:
#   DOMAIN=audio.example.com
#   ROOM_PASSWORD=<a password you distribute>
#   LIVEKIT_API_KEY=<change from devkey>
#   LIVEKIT_API_SECRET=<long random secret>
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

## 4. Path B — LAN / localhost (no TLS, simplest)

Every client on your network or your own machine — skip TLS, use `ws://`.

**Full LAN stack** (SFU + relay, UDP media):
```bash
cd packages/relay
export ROOM_PASSWORD=test          #  PowerShell: $env:ROOM_PASSWORD="test"
docker compose up -d --build
# tokenEndpoint = http://<your-LAN-ip>:8080   (or http://localhost:8080 same box)
```

**Beholder on the LAN:**
```bash
# from repo root (build needs core + contract sources)
docker build -f packages/listener/Dockerfile -t soundsbored-listener .
docker run -p 8081:80 \
  -e LISTENER_TOKEN_ENDPOINT="http://<your-LAN-ip>:8080" \
  -e LISTENER_ROOM="world1" \
  soundsbored-listener
```

**One-command localhost backend** (host-browser reachable, for the M4 gate on one
box):
```powershell
cd packages/relay
$env:ROOM_PASSWORD="test"
docker compose -f docker-compose.yml -f docker-compose.localhost.yml up -d --build
docker compose restart livekit    # the reconnect-blip test
```
Values: tokenEndpoint `http://localhost:8080`, room `world1`, password `test`.

---

## 5. Path C — Railway (partial: token + Beholder only)

Railway maps each compose service to its own Railway service with a public HTTPS
domain (see Railway's docker-compose guide). That's fine for the two **HTTP**
pieces, but **not** for the SFU:

- ✅ **Relay (token)** — deploy `packages/relay/Dockerfile` as a service. Public
  domain = your `tokenEndpoint`. Vars: `ROOM_PASSWORD`, `SFU_URL` (your SFU's
  `wss://` URL), `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`. Health check `/healthz`.
- ✅ **Beholder** — deploy `packages/listener/Dockerfile` as a service. Var
  `LISTENER_TOKEN_ENDPOINT` = the relay's Railway URL (players enter room +
  password). *(Separate Railway domains, so not same-origin — the endpoint is
  injected + locked instead.)*
- ❌ **SFU (`livekit-server`)** — Railway exposes services through a proxy that
  **remaps ports** and offers **no UDP**. LiveKit needs its media port reachable
  at the advertised number (§2), so the SFU's audio won't flow on Railway.

**So a Railway-only deployment can't carry audio.** Run the SFU where you control
ports (Path A's VPS, or a PaaS with direct UDP/TCP port mapping) and point the
Railway relay's `SFU_URL` at it. In practice, if you already have that box, run
the whole Path A stack there and skip Railway.

> **Plan/contract note:** CONTRACT C1/C9 assume a Railway-hosted TCP-only SFU.
> That assumption is untested and, per LiveKit's port rules, doubtful. Flagged
> for a contract review — the working path is a VPS (Path A).

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
   - Path A: `cd deploy && docker compose restart livekit`
   - Path B: `docker compose restart livekit`
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

- **Path A (VPS):** `deploy/docker-compose.yml` — SFU + relay + Beholder + Caddy,
  one stack, TLS, no SaaS.
- **Path B (LAN/localhost):** `packages/relay` compose, plain `http`/`ws`.
- **Path C (Railway):** token + Beholder only; SFU must live where ports are
  directly reachable.
