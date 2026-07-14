# soundsbored-remote-audio

LiveKit-based relay for SoundsBored remote audio streaming.

A Tauri soundboard app publishes a live WebRTC audio track to the LiveKit SFU. Remote listeners subscribe via the same room. This repo provides:

- **`@soundsbored/contract`** — shared TypeScript types for the token API
- **`@soundsbored/relay`** — Fastify HTTP service that mints LiveKit JWT tokens + LiveKit server configs

## Packages

| Package | Description |
|---------|-------------|
| `packages/contract` | Shared `TokenRequest`/`TokenResponse`/`TokenError` types + `Role` constants |
| `packages/relay` | Token mint endpoint (`POST /token`), LiveKit configs, Docker setup |
| `packages/core` | `listener-core` — subscribe/play/per-listener volume/reconnect (framework-agnostic) |
| `packages/listener` | Standalone self-host web listener (Vite) over `core` |

## Quick Start (self-host)

```bash
cp packages/relay/.env.example .env   # set ROOM_PASSWORD
docker compose -f packages/relay/docker-compose.yml up
```

Then POST to `http://localhost:8080/token`.

## Railway Deploy

Set env vars in Railway dashboard:
- `ROOM_PASSWORD` (required)
- `SFU_URL` → your LiveKit Cloud or self-hosted SFU URL
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` → matching your LiveKit key config

See [`packages/relay/README.md`](packages/relay/README.md) for full deploy instructions.

## Development

```bash
npm install
npm test          # run all tests
npm run build     # typecheck + emit
```

See [CONTRACT.md](CONTRACT.md) for the authoritative shared contract (C1–C7).
