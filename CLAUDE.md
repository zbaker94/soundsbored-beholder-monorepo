# soundsbored-remote-audio

Monorepo (npm workspaces). SoundsBored (Tauri app, separate repo) publishes its live master mix as ONE WebRTC audio track to a LiveKit SFU; remote listeners subscribe and hear it, each with own volume. A shared `core` lib owns the hard parts; `listener` and `foundry` are thin shells over it.

## Packages
- `contract` — shared token-endpoint types + room/role constants. **DONE**
- `relay` — LiveKit config + Fastify token endpoint + Docker. **DONE** (12 tests)
- `core` — listener-core (subscribe/play/volume/reconnect). **TODO (M2)**
- `listener` — standalone self-host web app. **TODO (M2)**
- `foundry` — thin Foundry VTT module. **TODO (M4)**

## Contract (authoritative: `CONTRACT.md`)
- SFU `ws(s)://host:7880` signaling; media 7881/TCP or 7882/UDP; clients auto-select ICE.
- Grants: publisher `canPublish:true/canSubscribe:false`; subscriber inverse.
- Token endpoint `POST /token {room,role,password}` → `{token,url}`; 401 bad pw; 400 bad body. Use `@soundsbored/contract` types.
- One publisher, one audio track. Listeners subscribe to ANY remote audio track (`RoomEvent.TrackSubscribed`, kind audio).
- Listener config = `{tokenEndpoint, room, password}` → POST /token role `subscriber` → connect.
- **Resilience (required in `core`):** livekit-client auto-reconnect; re-attach track on `Reconnected`; expose state `connecting|live|reconnecting|disconnected`; refresh token before expiry. UDP preferred, TCP fallback (stutters under loss).

## Conventions
- TS strict, ESM, single quotes, Zod for external input, Node ≥20.
- npm workspaces: root `npm install`; workspace deps use `"*"` (not `workspace:*`).
- vitest; mock `livekit-client` (won't run in test env). Focused files, one responsibility.
- `console` only in relay/CLI, never in `core` (embedded lib).
- Feature branch, not `main`. TDD core logic. Typecheck + full tests before commit. Don't commit build artifacts (gitignored).

## Verify (local, needs the app publishing)
LiveKit + the Tauri app live in `C:\Repos\sounds-bored\scripts\foundry-stream-check\` (127.0.0.1 TCP-only Docker + app Go Live). Then run the relay token endpoint:
`npm -w @soundsbored/relay run build && (cd packages/relay && ROOM_PASSWORD=test SFU_URL=ws://localhost:7880 node dist/index.js)`
Listener config: tokenEndpoint `http://localhost:8080`, room `spike`, pw `test`.
**M2 gate:** listener hears the mix + own volume; restart LiveKit mid-stream → auto-reconnects (`reconnecting`→`live`, audio resumes).

## Verify livekit APIs against current docs (context7) before using — don't guess.
