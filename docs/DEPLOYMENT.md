# Deployment Guide — SoundsBored Remote Audio

How to run the stack somewhere real so remote listeners hear the GM's mix over
the internet. Covers both hosting tracks (**Railway/managed** and **self-host**)
and both listener paths (**Foundry module** and the **Beholder** standalone
listener).

Read [`CONTRACT.md`](../CONTRACT.md) first if you want the wire-level detail
(C1–C10). This guide is the operational how-to.

---

## 1. What you are deploying

Three moving parts:

| Component | What it is | Where it lives |
|-----------|-----------|----------------|
| **Publisher** | The SoundsBored Tauri app. Publishes ONE WebRTC audio track (the master mix). | Your machine (sibling repo `sounds-bored`) |
| **Relay** | LiveKit **SFU** (media server) + a **token endpoint** (`POST /token`, `GET /healthz`). | `packages/relay` — Docker / Railway |
| **Consumer** | Either the **Foundry module** (`soundsbored-audio`) or the **Beholder** web listener (`packages/listener`). | Foundry client / a web page |

Everyone — publisher and every consumer — only ever configures the same three
values (Contract C6):

```
tokenEndpoint   the relay's public URL   e.g. https://relay.example.com
room            an agreed string         e.g. world1   (MUST match on all sides)
password        the shared room password (relay ROOM_PASSWORD)
```

Each side POSTs `/token` with its role (`publisher` or `subscriber`) and gets
back `{ token, url }` — no raw tokens or SFU URLs are ever hand-copied.

---

## 2. The one constraint that makes or breaks it

WebRTC media has to actually reach the client. Two things decide whether it does:

1. **ICE reachability.** The SFU advertises candidate IP:port pairs. The client
   must be able to reach one. A Docker-internal IP is NOT reachable from a host
   browser; a `127.0.0.1` candidate is NOT reachable from another machine. The
   LiveKit config you pick sets this.
2. **TLS (`wss://`).** A browser on an **https** page (a hosted Foundry, a hosted
   listener) can only open a **secure** WebSocket (`wss://`) and secure media.
   Plain `ws://` works **only** from `http://localhost` / a LAN http page. So any
   real over-the-internet deployment needs TLS in front of the SFU signaling port
   and an https relay. (LiveKit's own docs: put `:7880` behind a load balancer
   that terminates SSL; TURN over TLS is needed for restrictive networks.)

**This is why the localhost harness and a real deployment use different LiveKit
configs.** The three shipped configs:

| Config | Media | Advertises | Use |
|--------|-------|-----------|-----|
| `livekit.selfhost.yaml` | UDP mux `7882` (+ TCP `7881`) | auto `use_external_ip` | Self-host on a box with a routable IP |
| `livekit.railway.yaml`  | TCP `7881` only | `use_external_ip` | Self-hosted SFU where UDP isn't available |
| `livekit.localdev.yaml` | TCP `7881` only | `127.0.0.1` | Localhost-only host-browser testing |

Compose files that wire them:

| File | Stack | For |
|------|-------|-----|
| `docker-compose.yml` | SFU (selfhost.yaml) + relay, both in Docker | Real self-host |
| `docker-compose.localhost.yml` (layer over base) | SFU (localdev.yaml, loopback) + relay | One-command **localhost** backend |
| `docker-compose.localdev.yml` | SFU only; run relay/listener from host | Iterating locally |

> **Managed vs self-hosted SFU.** You can either run the LiveKit SFU yourself
> (the configs above) **or** use **LiveKit Cloud**, which hosts the SFU +
> TURN/TLS for you and hands you a `wss://…` URL and an API key/secret. Cloud
> removes the TLS/ICE burden entirely — it is the fastest way to get a working
> internet deployment, and the recommended path below.

---

## 3. Track A — Railway relay + LiveKit Cloud SFU (recommended)

The least-moving-parts way to get audio flowing over the internet. LiveKit Cloud
is the SFU; Railway runs only the token endpoint.

### A1. LiveKit Cloud project (the SFU)

1. Create a project at <https://cloud.livekit.io> (free tier is enough for one
   audio track).
2. From the project settings copy three values:
   - **WebSocket URL** — `wss://<your-project>.livekit.cloud`
   - **API Key**
   - **API Secret**

That's the whole SFU. Cloud handles ICE/TURN/TLS.

### A2. Relay on Railway (the token endpoint)

The relay is a Fastify service built by `packages/relay/Dockerfile` (build
context = repo root — it needs the `contract` workspace).

1. Push this repo to GitHub (see §6 if you haven't yet).
2. Railway → **New Project → Deploy from GitHub repo** → pick this repo.
3. In the service settings:
   - **Dockerfile path:** `packages/relay/Dockerfile`
   - **Root directory:** repo root (the Dockerfile COPYs from root).
4. **Variables:**
   | Variable | Value |
   |----------|-------|
   | `ROOM_PASSWORD` | a real shared password you'll distribute |
   | `SFU_URL` | `wss://<your-project>.livekit.cloud` (from A1) |
   | `LIVEKIT_API_KEY` | LiveKit Cloud API key |
   | `LIVEKIT_API_SECRET` | LiveKit Cloud API secret |
   | *(PORT)* | leave unset — Railway injects it, the relay reads it |
5. **Networking:** enable a public domain → you get
   `https://<svc>.up.railway.app`. That URL is your **`tokenEndpoint`**.
6. **Health check path:** `/healthz`.

Verify:

```bash
curl -X POST https://<svc>.up.railway.app/token \
  -H 'Content-Type: application/json' \
  -d '{"room":"world1","role":"subscriber","password":"YOUR_PASSWORD"}'
# → {"token":"...","url":"wss://<your-project>.livekit.cloud"}
# wrong password → 401 {"error":"bad password"}
```

CORS is already `*` on the relay, so browser consumers on any origin work.

### A3. Publisher (the app) against it

In the SoundsBored app Settings: `tokenEndpoint` = the Railway URL, `room` =
`world1`, `password` = your password → **Go Live**. One audio track goes up.

### A4a. Consumer — Foundry module

Install the module (§5), then as GM set the module settings to the **same**
Railway `tokenEndpoint` / `room` / `password`. Players click the headphones
scene-control → **Join audio**.

### A4b. Consumer — Beholder listener (optional second Railway service)

Deploy the standalone listener as its own service so players who aren't in
Foundry can still listen from a URL.

1. Railway → **New service** in the same project → same repo.
2. **Dockerfile path:** `packages/listener/Dockerfile` (context = repo root).
3. **Variables:**
   | Variable | Value | Effect |
   |----------|-------|--------|
   | `LISTENER_TOKEN_ENDPOINT` | the relay Railway URL | pre-fills + **locks** the endpoint field |
   | `LISTENER_ROOM` | `world1` | pre-fills + **locks** the room field |
   *(Password is never injected — listeners type it.)*
4. Public domain → players open `https://<listener-svc>.up.railway.app`, enter
   the password, press play.

> **Same-origin option:** if you put the listener and relay behind one hostname
> (reverse proxy, listener at `/`, relay at `/token`), set
> `LISTENER_TOKEN_ENDPOINT=""` — the field hides and the app POSTs a relative
> `/token`. Then listeners configure only the password.

---

## 4. Track B — Full self-host (your own box / VPS)

Run everything yourself. Fine for a LAN game with **no TLS**; for players over
the internet you must add TLS (see B4).

### B1. SFU + relay via Docker Compose

Requires a machine with a routable IP (or port-forwarding) and Docker.

```bash
cd packages/relay
export ROOM_PASSWORD=your-secret-password          # bash
#   $env:ROOM_PASSWORD="your-secret-password"      # PowerShell
docker compose up -d --build
```

This starts the SFU (`livekit.selfhost.yaml`) + the token service. Open these
ports on the host/router:

| Port | Proto | Purpose |
|------|-------|---------|
| `7880` | TCP | LiveKit signaling (ws/wss) |
| `7881` | TCP | LiveKit media (TCP fallback) |
| `7882` | UDP | LiveKit media (preferred) |
| `8080` | TCP | Token endpoint |

`use_external_ip: true` auto-detects the public IP for ICE candidates.

### B2. Consumers point at your box

- `tokenEndpoint` = `http://<your-host>:8080`
- On a **LAN / http** page this works as-is (`ws://` media is allowed).
- Publisher (app) and every consumer use the same three values.

### B3. Foundry module / Beholder against self-host

- **Foundry module:** install (§5), GM sets `tokenEndpoint` `http://<host>:8080`,
  `room`, `password`.
- **Beholder (Docker):** build + run the listener image:
  ```bash
  # from repo root (build needs core + contract sources)
  docker build -f packages/listener/Dockerfile -t soundsbored-listener .
  docker run -p 8081:80 \
    -e LISTENER_TOKEN_ENDPOINT="http://<your-host>:8080" \
    -e LISTENER_ROOM="world1" \
    soundsbored-listener
  # players open http://<your-host>:8081, enter the password
  ```

### B4. Going over the internet from self-host (TLS — required)

A hosted Foundry/listener served over **https** cannot talk to a plain `ws://`
SFU. Put a TLS-terminating reverse proxy (Caddy/nginx/Traefik) in front:

- `wss://relay.example.com` → proxy → `livekit:7880` (WebSocket upgrade).
- `https://relay.example.com/token` → proxy → `token:8080`.
- Keep media ports open: `7881/tcp` and `7882/udp` to the SFU host.
- For clients on restrictive networks you also need **TURN over TLS** — LiveKit
  self-host requires configuring a TURN server + certs (LiveKit Cloud includes
  this; it's the main reason Track A is easier).

Then consumers use `tokenEndpoint = https://relay.example.com`. Because
`use_external_ip` advertises the box's public IP, ICE resolves to a reachable
candidate.

> **A self-hosted SFU on Railway** is possible with `livekit.railway.yaml` (TCP
> `7881` only, via a Railway TCP proxy) but is fiddly (two ports, no UDP). If you
> want managed, prefer LiveKit Cloud (Track A) over self-hosting the SFU on
> Railway.

### B5. Security — change the dev keys

`livekit.selfhost.yaml` / `railway.yaml` ship with `devkey: secret` and the
relay defaults to the same. **For any non-LAN deployment, change them:**

1. Edit the `keys:` block in the LiveKit yaml to a strong key/secret.
2. Set the relay's `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` to match.

(LiveKit Cloud gives you real keys, so Track A avoids this.)

---

## 5. Installing the Foundry module

Two ways.

### 5a. From the manifest URL (needs a published release)

Once a `foundry-v*` tag is pushed and CI has published the release (§6), in
Foundry: **Add-on Modules → Install Module → Manifest URL**:

```
https://github.com/zbaker94/soundsbored-remote-audio/releases/latest/download/module.json
```

### 5b. Manual (no release needed — good for the first gate run)

```bash
npm run build -w @soundsbored/foundry     # produces packages/foundry/dist/
```

Copy the **contents** of `packages/foundry/dist/` into your Foundry data dir at
`Data/modules/soundsbored-audio/` (so `module.json` sits at that folder's root).
Restart Foundry, enable the module.

Either way: enable it (v13+), then **Game Settings → Configure Settings →
SoundsBored Remote Audio** and set `tokenEndpoint` / `room` / `password`. World
settings are GM-only to edit and readable by all players (so their browsers can
fetch a subscriber token). Players then use the headphones scene control →
**Join audio**.

---

## 6. Publishing a release (for the manifest URL + CI)

`main` is currently merged locally. To make the manifest install work:

```bash
git push origin main                       # push the merged branch
git tag foundry-v0.0.1
git push origin foundry-v0.0.1             # triggers .github/workflows/foundry-release.yml
```

CI builds the module, stamps the version + download URL into `module.json`, zips
`dist/`, and attaches `module.json` + `module.zip` to a GitHub Release. The
`manifest` URL (`releases/latest/download/module.json`) then resolves.

---

## 7. Verification / the M4 gate

With the app publishing and a consumer configured:

1. **Audio flows** — a remote player hears the mix.
2. **Own volume** — the player's volume slider changes only their playback.
3. **Reconnect blip** — restart the SFU mid-stream and audio auto-recovers:
   - Self-host / localhost: `docker compose restart livekit`
   - LiveKit Cloud: (can't restart Cloud) — instead drop the player's network
     briefly, or restart the publisher; the consumer's status pill should go
     `reconnecting` → `live` and audio should resume.
4. **Status pill** reflects `connecting` / `live` / `reconnecting` / `disconnected`.

Run through this for whichever consumer(s) you deployed.

### Foundry-specific things to eyeball on the first live run

These are the v13 client-API shapes that can only be confirmed against a running
Foundry:

- The **headphones scene-control** tool appears and opens the panel.
- The panel **renders** (status pill, Join/Leave, volume, mute).
- **Join** starts audio (the click is the browser gesture that unlocks playback).

---

## 8. Quick reference — who points where

```
Publisher (app) ─┐
                 ├─ tokenEndpoint ──▶ Relay /token ──▶ mints token ──▶ SFU (LiveKit / Cloud)
Foundry module ──┤                                                        ▲
Beholder web  ───┘                                                        │
   every side: same room + password ───────── audio track ───────────────┘
```

- **Track A:** `tokenEndpoint` = Railway relay; SFU = LiveKit Cloud.
- **Track B:** `tokenEndpoint` = your relay host; SFU = your Docker LiveKit.
