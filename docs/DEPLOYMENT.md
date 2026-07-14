# Deployment Guide — SoundsBored Remote Audio

How to run the stack somewhere real so remote listeners hear the GM's mix over
the internet. **No SaaS dependency** — the LiveKit SFU is the open-source
`livekit-server` container you run yourself. All you supply is *a host*.

Read [`CONTRACT.md`](../CONTRACT.md) for the wire-level detail (C1–C10); this is
the operational how-to. Covers both hosting styles (**self-host on a
box/PaaS** and **LAN/localhost**) and both listener paths (**Foundry module**
and the **Beholder** standalone listener).

---

## 1. What you are deploying

Three moving parts — all self-hosted, no third-party service:

| Component | What it is | Where it lives |
|-----------|-----------|----------------|
| **Publisher** | The SoundsBored Tauri app. Publishes ONE WebRTC audio track (the master mix). | Your machine (sibling repo `sounds-bored`) |
| **Relay** | LiveKit **SFU** (`livekit-server`, OSS) + a **token endpoint** (`POST /token`, `GET /healthz`). | `packages/relay` — Docker |
| **Consumer** | Either the **Foundry module** (`soundsbored-audio`) or the **Beholder** web listener (`packages/listener`). | Foundry client / a web page |

Everyone — publisher and every consumer — only configures the same three values
(Contract C6):

```
tokenEndpoint   the relay's public URL   e.g. https://relay.example.com
room            an agreed string         e.g. world1   (MUST match on all sides)
password        the shared room password (relay ROOM_PASSWORD)
```

Each side POSTs `/token` with its role (`publisher` / `subscriber`) and gets back
`{ token, url }`. No raw tokens or SFU URLs are ever hand-copied.

> **No LiveKit account.** `livekit-server` is open source and already wired into
> `packages/relay/docker-compose.yml`. You run it with your own keys. (LiveKit
> also sells a hosted SFU — see the optional appendix §8 — but nothing here
> requires it.)

---

## 2. The one constraint that makes or breaks it

WebRTC media has to actually reach the client. Two things decide whether it does:

1. **ICE reachability.** The SFU advertises candidate IP:port pairs; the client
   must reach one. A Docker-internal IP is unreachable from a host browser; a
   `127.0.0.1` candidate is unreachable from another machine. The LiveKit config
   you pick sets this (`use_external_ip` / `node_ip`).
2. **TLS (`wss://`).** A browser on an **https** page (hosted Foundry, hosted
   listener) can only open a **secure** WebSocket + secure media. Plain `ws://`
   works **only** from `http://localhost` or a LAN http page. So any real
   over-the-internet deployment needs TLS in front of the SFU signaling port and
   an https relay. (LiveKit's own guidance: put `:7880` behind something that
   terminates SSL.)

**This is why localhost testing and a real deployment use different LiveKit
configs.** The three shipped configs:

| Config | Media | Advertises | Use |
|--------|-------|-----------|-----|
| `livekit.selfhost.yaml` | UDP mux `7882` (+ TCP `7881`) | auto `use_external_ip` | Self-host on a box with a routable IP (UDP available) |
| `livekit.railway.yaml`  | TCP `7881` only | `use_external_ip` | Self-host where UDP isn't available (PaaS) |
| `livekit.localdev.yaml` | TCP `7881` only | `127.0.0.1` | Localhost-only host-browser testing |

Compose files that wire them:

| File | Stack | For |
|------|-------|-----|
| `docker-compose.yml` | SFU (selfhost.yaml) + relay, both in Docker | Real self-host |
| `docker-compose.localhost.yml` (layer over base) | SFU (localdev.yaml, loopback) + relay | One-command **localhost** backend |
| `docker-compose.localdev.yml` | SFU only; run relay/listener from host | Iterating locally |

---

## 3. Track A — Self-host over the internet (recommended)

Run `livekit-server` + the relay yourself. The only external thing is a host with
a public, TLS-terminating endpoint. Three concrete ways to get that, cheapest
control-tradeoff first.

### A0. The stack (same everywhere)

```bash
cd packages/relay
export ROOM_PASSWORD=your-secret-password          # bash
#   $env:ROOM_PASSWORD="your-secret-password"      # PowerShell
docker compose up -d --build
```

Starts the SFU (`livekit.selfhost.yaml`) + token service. Ports:

| Port | Proto | Purpose |
|------|-------|---------|
| `7880` | TCP | LiveKit signaling (ws → wss behind TLS) |
| `7881` | TCP | LiveKit media (TCP fallback) |
| `7882` | UDP | LiveKit media (preferred) |
| `8080` | TCP | Token endpoint |

For the internet you must add **TLS** in front (browsers need `wss://`). The rest
of A1/A2/A3 differ only in *where* this runs and how TLS is obtained.

### A1. A VPS you own (DigitalOcean / Hetzner / any box) — most control

Full UDP, your own domain, auto-TLS with Caddy. No PaaS.

1. Point a domain at the box, e.g. `relay.example.com`.
2. Run the stack (A0).
3. Put **Caddy** in front for automatic Let's Encrypt TLS (no account beyond the
   domain registrar). Minimal `Caddyfile`:
   ```
   relay.example.com {
     # token endpoint
     handle /token* { reverse_proxy localhost:8080 }
     handle /healthz { reverse_proxy localhost:8080 }
     # LiveKit signaling (WebSocket upgrade)
     handle { reverse_proxy localhost:7880 }
   }
   ```
4. Open media ports on the firewall/router: `7881/tcp` and `7882/udp`.
5. Consumers use `tokenEndpoint = https://relay.example.com`. `use_external_ip`
   advertises the box's public IP, so ICE resolves to a reachable candidate.

> For clients on restrictive networks (symmetric NAT / corporate firewalls) you
> may also need a **TURN server with TLS**. Self-host TURN via LiveKit's
> `turn:` config block + a cert. For a home game this is usually unnecessary —
> the TCP `7881` fallback covers most cases.

### A2. Fly.io — a PaaS that supports UDP + gives you TLS free

No domain purchase, UDP works, free `*.fly.dev` TLS.

1. `fly launch` from the repo; use `packages/relay/Dockerfile` (context = repo
   root). Fly gives the app `https://<app>.fly.dev` (TLS handled at the edge).
2. In `fly.toml`, expose the SFU signaling as the HTTP service (→ `wss` via Fly
   TLS) **and** the media ports. Fly supports UDP + TCP services and dedicated
   IPs — map `7882/udp` and `7881/tcp`. (Check Fly's current UDP + `[[services]]`
   port syntax when you write the toml.)
3. Env: `ROOM_PASSWORD`, and if you split the SFU into its own Fly app, point the
   relay's `SFU_URL` at the SFU app's `wss://…` URL.
4. Consumers use `tokenEndpoint = https://<relay-app>.fly.dev`.

### A3. Railway — easiest for the relay; SFU is TCP-only there

Railway gives each service a free TLS domain but no UDP, so media falls back to
TCP `7881` (works; stutters under packet loss — head-of-line blocking).

1. **Relay service:** New Project → Deploy from GitHub repo → this repo.
   Dockerfile path `packages/relay/Dockerfile`, root dir = repo root. Public
   domain → `https://<svc>.up.railway.app` = your `tokenEndpoint`. Health check
   `/healthz`.
2. **SFU service:** run `livekit/livekit-server` with `livekit.railway.yaml`
   (TCP-only). Expose `7880` as the HTTP port (→ `wss` via Railway TLS) and add a
   **TCP proxy** for `7881`. Set the relay's `SFU_URL` to the SFU service's
   `wss://…` domain, and `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` to match the
   yaml's `keys:` (change them from the dev defaults — §A4).
   *(Two ports on one service is fiddly; if it fights you, prefer A1/A2.)*

Verify any of the above:

```bash
curl -X POST https://<your-relay-host>/token \
  -H 'Content-Type: application/json' \
  -d '{"room":"world1","role":"subscriber","password":"YOUR_PASSWORD"}'
# → {"token":"...","url":"wss://<your-sfu>..."}
# wrong password → 401 {"error":"bad password"}
```

CORS is `*` on the relay, so browser consumers on any origin work.

### A4. Change the dev keys (required for anything non-LAN)

`livekit.selfhost.yaml` / `railway.yaml` ship with `devkey: secret` and the relay
defaults match. For an internet deployment:

1. Edit the `keys:` block in the LiveKit yaml to a strong key/secret.
2. Set the relay's `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` to match.

### A5. Publisher (the app)

App Settings: `tokenEndpoint` = your relay URL, `room` = `world1`, `password` =
yours → **Go Live**. One audio track goes up.

### A6. Consumer — Foundry module

Install the module (§5), then as GM set the module settings to the **same**
`tokenEndpoint` / `room` / `password`. Players click the headphones scene-control
→ **Join audio**.

### A7. Consumer — Beholder listener (optional)

Serve the standalone listener so non-Foundry players can listen from a URL.

- **Docker (any host):** build from repo root (needs core + contract sources):
  ```bash
  docker build -f packages/listener/Dockerfile -t soundsbored-listener .
  docker run -p 8081:80 \
    -e LISTENER_TOKEN_ENDPOINT="https://relay.example.com" \
    -e LISTENER_ROOM="world1" \
    soundsbored-listener
  ```
  `LISTENER_*` vars pre-fill **and lock** those fields (operator config); the
  password is never injected — players type it. Put it behind the same TLS proxy
  as the relay for internet use.
- **Same-origin option:** serve the listener at `/` and the relay at `/token` on
  one hostname, set `LISTENER_TOKEN_ENDPOINT=""` → the field hides and the app
  POSTs a relative `/token`. Listeners then configure only the password.

---

## 4. Track B — LAN / localhost (no TLS, simplest)

For a game where every client is on your network (or your own machine), skip TLS
entirely — `ws://` is allowed from http/LAN pages.

```bash
cd packages/relay
export ROOM_PASSWORD=test
docker compose up -d --build      # SFU (selfhost.yaml, UDP) + relay
```

- `tokenEndpoint` = `http://<your-LAN-ip>:8080` (or `http://localhost:8080` on
  the same box).
- Publisher + all consumers use that + `room` + `password`.
- **Foundry:** install (§5), GM sets those values.
- **Beholder:** `docker run … -e LISTENER_TOKEN_ENDPOINT="http://<lan-ip>:8080"
  -e LISTENER_ROOM="world1" -p 8081:80 soundsbored-listener`.

**One-command localhost backend** (host-browser reachable, relay in Docker too):

```powershell
$env:ROOM_PASSWORD="test"
docker compose -f docker-compose.yml -f docker-compose.localhost.yml up -d --build
docker compose restart livekit    # the reconnect-blip test
```

Values: tokenEndpoint `http://localhost:8080`, room `world1`, password `test`.
(This layers `livekit.localdev.yaml` — TCP loopback — over the base stack.)

---

## 5. Installing the Foundry module

### 5a. From the manifest URL (needs a published release — §6)

Foundry → **Add-on Modules → Install Module → Manifest URL**:

```
https://github.com/zbaker94/soundsbored-remote-audio/releases/latest/download/module.json
```

### 5b. Manual (no release needed — good for the first gate run)

```bash
npm run build -w @soundsbored/foundry     # produces packages/foundry/dist/
```

Copy the **contents** of `packages/foundry/dist/` into your Foundry data dir at
`Data/modules/soundsbored-audio/` (so `module.json` is at that folder's root).
Restart Foundry, enable the module.

Either way: enable it (v13+), then **Game Settings → Configure Settings →
SoundsBored Remote Audio** → set `tokenEndpoint` / `room` / `password`. World
settings are GM-only to edit, readable by all players (so their browsers fetch a
subscriber token). Players use the headphones scene control → **Join audio**.

---

## 6. Publishing a release (for the manifest URL + CI)

`main` currently holds the merged module. To make the manifest install work:

```bash
git push origin main
git tag foundry-v0.0.1
git push origin foundry-v0.0.1        # triggers .github/workflows/foundry-release.yml
```

CI builds the module, stamps version + download URL into `module.json`, zips
`dist/`, and attaches `module.json` + `module.zip` to a GitHub Release. The
`manifest` URL then resolves. (This needs the repo on GitHub — no other service.)

---

## 7. Verification / the M4 gate

With the app publishing and a consumer configured:

1. **Audio flows** — a remote player hears the mix.
2. **Own volume** — the player's slider changes only their playback.
3. **Reconnect blip** — restart the SFU mid-stream; audio auto-recovers. Pill
   goes `reconnecting` → `live`.
   - Docker/self-host: `docker compose restart livekit`.
4. **Status pill** reflects `connecting` / `live` / `reconnecting` / `disconnected`.

### Foundry-specific things to eyeball on the first live run (v13 client API)

- The **headphones scene-control** tool appears and opens the panel.
- The panel **renders** (status pill, Join/Leave, volume, mute).
- **Join** starts audio (the click is the browser gesture that unlocks playback).

---

## 8. Appendix — managed SFU (optional, not required)

If you ever *don't* want to run the SFU or manage TLS/TURN yourself, LiveKit sells
a hosted SFU (LiveKit Cloud): create a project, get a `wss://…` URL + API
key/secret, set them as the relay's `SFU_URL` / `LIVEKIT_API_KEY` /
`LIVEKIT_API_SECRET`, and skip running `livekit-server`. This is a convenience,
**not** a dependency — Track A needs no such account.

---

## 9. Quick reference — who points where

```
Publisher (app) ─┐
                 ├─ tokenEndpoint ──▶ Relay /token ──▶ mints token ──▶ SFU (self-hosted livekit-server)
Foundry module ──┤                                                        ▲
Beholder web  ───┘                                                        │
   every side: same room + password ───────── audio track ───────────────┘
```

- **Track A (internet):** you host `livekit-server` + relay behind TLS (VPS+Caddy,
  Fly, or Railway). No SaaS SFU.
- **Track B (LAN/localhost):** `docker compose up`, plain `http`/`ws`.
