# Deploy profiles

Three self-contained ways to run the **full stack** (LiveKit SFU + relay token
endpoint + Beholder listener). All self-hosted — no third-party service. In every
profile the Beholder listener has its relay endpoint injected + locked, so
listeners enter only **room + password**; the Foundry module is configured with
the same `tokenEndpoint`. The `udp` profile uses two subdomains — one for
Beholder, one for the relay (which fronts both the token endpoint and the SFU);
`tcp` and `local` inject the relay URL directly.

Pick by where you're hosting:

| Profile | Directory | Media | TLS | Use when |
|---------|-----------|-------|-----|----------|
| **UDP** | [`udp/`](udp/) | UDP (7882) + TCP fallback | Caddy (auto Let's Encrypt) | A VPS / box with a public IP + a domain. Best audio. |
| **TCP** | [`tcp/`](tcp/) | TCP-only, via proxy-port bridge | platform edge (e.g. Railway) | A no-UDP PaaS (Railway). See [`tcp/RAILWAY.md`](tcp/RAILWAY.md). |
| **Local** | [`local/`](local/) | TCP loopback | none (`ws`/`http`) | Your own machine / LAN. The M4 gate, quick tests. |

Full walkthrough + the Foundry module setup: [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

## Quick start per profile

```bash
# UDP (VPS + domain)
cd deploy/udp && cp .env.example .env   # set DOMAIN, ROOM_PASSWORD, LIVEKIT_API_*
docker compose up -d --build

# TCP (no-UDP host; localhost sim shown — for Railway see tcp/RAILWAY.md)
cd deploy/tcp && cp .env.example .env   # set ROOM_PASSWORD, LIVEKIT_API_*
docker compose up -d --build

# Local (zero-config: dev keys, password "test")
cd deploy/local
docker compose up -d --build
```

## Shared notes

- **Keys:** every profile signs tokens on the relay and verifies on the SFU with
  `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` — they must match. Change them from the
  dev defaults for anything beyond localhost.
- **Password:** `ROOM_PASSWORD` is the shared room password you distribute; it is
  never baked into the Beholder image.
- **`.env` files are gitignored** — only `.env.example` is committed.
- **Reconnect-blip test (M4 gate):** `docker compose restart livekit` in the
  chosen profile dir → the consumer's status pill goes `reconnecting` → `live`.
