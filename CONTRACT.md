# SoundsBored Remote Audio — Shared Contract

> Canonical copy. The master plan in the `sounds-bored` repo
> (`docs/superpowers/plans/2026-07-14-foundry-audio-master-plan.md`) mirrors
> **C1–C7**. Change both in lockstep — never diverge silently.
>
> **C1–C7** are the cross-repo client/server contract (shared by publisher,
> listener-core, and both consumers). **C8–C10** are relay operational detail
> (env, LiveKit config, deployment) — relay-internal, referenced by the relay
> package only.

## C1 SFU URL / Ports

- Self-host: `ws://<host>:7880`. Railway: `wss://<subdomain>.up.railway.app`.
- Signaling: `7880` (ws/wss). Media: `7881/TCP` (Railway) or `7882/UDP` (self-host).
- Clients auto-select ICE candidates — no client-side transport config.

## C2 Room Identity

- `room` is an arbitrary non-empty string chosen by the operator (default suggestion: a session/world id).
- **Publisher and all listeners MUST use the identical `room` string.** The single value that must match across sides.

## C3 Token Grants (minted by the relay, never in a browser)

- **publisher**: `{ roomJoin: true, room, canPublish: true, canSubscribe: false }`
- **subscriber**: `{ roomJoin: true, room, canPublish: false, canSubscribe: true }`
- Signed with the LiveKit API key/secret held only by the relay.

## C4 Token Endpoint (HTTP, the integration seam)

Co-deployed with the SFU. Publisher and every listener call it.

```
POST /token   Content-Type: application/json
Body: { room: string, role: 'publisher' | 'subscriber', password: string }

200 → { token: string, url: string }   // url = SFU ws/wss URL (C1), from env SFU_URL
401 → { error: 'bad password' }
400 → { error: 'bad request' }
```

- `password` is checked against env `ROOM_PASSWORD` (C8); it is the single shared room password the operator sets and distributes.
- Role → grant per C3. `url` is returned so clients need only the token endpoint + room + password.
- CORS: `Access-Control-Allow-Origin: *`, methods POST + OPTIONS, `Content-Type` header. (Tokens are password-gated; the SFU enforces grants.)

## C5 Track Model

- Exactly one participant publishes (the app), one audio track. Listeners subscribe to **any** remote audio track in the room (`RoomEvent.TrackSubscribed`, kind `audio`). No track-name matching in v1.

## C6 Operator / Listener Configuration (identical shape everywhere)

- Each side collects exactly: `tokenEndpoint`, `room` (C2), `password` (C4).
- Each POSTs `/token` with its role → `{ token, url }`. **No raw tokens or SFU URLs hand-copied** once the endpoint exists.

## C7 Resilience (owned by `listener-core` + publisher)

- Use LiveKit auto-reconnect: the **publisher re-publishes its track on `RoomEvent.Reconnected`**; listeners re-attach the resubscribed track. Handle `Reconnecting` / `Reconnected` / `Disconnected`.
- Surface connection state (`connecting` / `waiting` / `live` / `reconnecting` / `disconnected`) in every UI. `connecting` = still establishing the connection; `waiting` = joined the room but the publisher's audio track hasn't arrived (or dropped); `live` = audio playing.
- Prefer UDP where available (self-host); TCP is the always-works fallback (stutters under loss — head-of-line blocking).
- Refresh tokens before expiry. Long-task + connection-state instrumentation on both sides.

---

## C8 Relay Environment Variables

| Variable            | Required | Default             | Notes                        |
|---------------------|----------|---------------------|------------------------------|
| `PORT`              | No       | `8080`              | HTTP listen port             |
| `LIVEKIT_API_KEY`   | No       | `devkey`            | LiveKit API key              |
| `LIVEKIT_API_SECRET`| No       | `secret`            | LiveKit API secret           |
| `ROOM_PASSWORD`     | **Yes**  | —                   | Shared room password; exit 1 if unset |
| `SFU_URL`           | No       | `ws://localhost:7880` | WebSocket URL for LiveKit SFU (returned as C4 `url`) |

- Dev credential defaults: `devkey` / `secret`.

## C9 LiveKit Config

- Self-host: UDP port 7882, `use_external_ip: true`.
- Railway: TCP port 7881, `use_external_ip: true`, no UDP.

## C10 Docker / Deployment

- `livekit-server` + `token` service via `docker-compose.yml` (self-host).
- Railway: deploy `token` service, point `SFU_URL` at LiveKit Cloud or a separate instance.
