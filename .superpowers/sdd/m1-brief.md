# M1 Build Brief — soundsbored-remote-audio monorepo: contract + relay

Greenfield. Build an npm-workspaces monorepo. This milestone delivers the shared `contract` package and the `relay` package (LiveKit SFU config + a token-mint HTTP endpoint). No listener/foundry packages yet (later milestones).

Repo root: `C:\Repos\soundsbored-remote-audio` (fresh empty git repo, remote = github zbaker94/soundsbored-remote-audio).

## Shared Contract (authoritative — implement exactly)

### C1 SFU URL / ports
- Signaling `7880` (ws/wss). Media `7881/TCP` (Railway) or `7882/UDP` (self-host).

### C3 Token grants
- publisher: `{ roomJoin: true, room, canPublish: true, canSubscribe: false }`
- subscriber: `{ roomJoin: true, room, canPublish: false, canSubscribe: true }`

### C4 Token endpoint
```
POST /token   Content-Type: application/json
Body: { room: string, role: 'publisher' | 'subscriber', password: string }
200 → { token: string, url: string }     // url = SFU ws/wss URL (env SFU_URL)
401 → { error: 'bad password' }
400 → { error: 'bad request' }
```
- Password checked against env `ROOM_PASSWORD`. Role→grant per C3. `url` = env `SFU_URL`.
- CORS: `Access-Control-Allow-Origin: *`, allow POST + OPTIONS, `Content-Type` header.
- LiveKit creds from env `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` (dev defaults `devkey`/`secret`).

## Structure to create

```
package.json                 # root; private; workspaces: ["packages/*"]; scripts (build/test/lint)
tsconfig.base.json           # shared strict TS config
.gitignore                   # node_modules, dist, .env
CONTRACT.md                  # paste the Shared Contract (C1–C7) — ask controller for the text; or copy this brief's contract section
README.md                    # what the repo is; deploy pointers
packages/
  contract/
    package.json             # name @soundsbored/contract; main dist or src exports
    tsconfig.json
    src/index.ts             # C4 types + room/role constants (see below)
  relay/
    package.json             # name @soundsbored/relay; deps: fastify, @fastify/cors, livekit-server-sdk, zod, @soundsbored/contract (workspace:*)
    tsconfig.json
    src/tokens.ts            # buildGrant(role) + mintToken(...) pure fns (TDD)
    src/server.ts            # Fastify app factory: buildServer() with POST /token + CORS
    src/index.ts             # boot: read env, listen on PORT (default 8080)
    src/tokens.test.ts       # vitest
    src/server.test.ts       # vitest (fastify .inject())
    livekit.selfhost.yaml    # UDP 7882 mux, use_external_ip true, keys
    livekit.railway.yaml     # TCP-only 7881, use_external_ip true, no udp
    Dockerfile               # builds the token service
    docker-compose.yml       # livekit-server + token service (self-host, UDP open)
    README.md                # deploy: Railway + self-host
```

## contract/src/index.ts (exact shape)
```ts
export type Role = 'publisher' | 'subscriber';
export interface TokenRequest { room: string; role: Role; password: string }
export interface TokenResponse { token: string; url: string }
export interface TokenError { error: string }
export const ROLES: readonly Role[] = ['publisher', 'subscriber'];
```

## relay/src/tokens.ts
- `export function buildGrant(role: Role, room: string): VideoGrant` returning the C3 grant object for the role.
- `export async function mintToken(opts: { apiKey; apiSecret; identity; room; role }): Promise<string>` using `livekit-server-sdk` `AccessToken` + `addGrant` + `toJwt`.
- IMPORTANT: verify the CURRENT `livekit-server-sdk` API via context7 (resolve-library-id "livekit-server-sdk", query-docs "AccessToken addGrant VideoGrant toJwt server sdk mint token"). Confirm `AccessToken` ctor, `addGrant` field names (roomJoin/room/canPublish/canSubscribe), and that `toJwt()` is async. Follow the real API; note any deviation.

## relay/src/server.ts
- `export function buildServer(deps: { apiKey; apiSecret; roomPassword; sfuUrl }): FastifyInstance`.
- Register `@fastify/cors` with `origin: '*'`, methods POST/OPTIONS.
- `POST /token`: zod-validate body against TokenRequest (room non-empty, role in ROLES, password non-empty) → 400 `{error:'bad request'}` on parse fail; compare password to `roomPassword` → 401 `{error:'bad password'}`; else mint token (identity = a random-ish string derived from role+room+count; do NOT use Math.random if it complicates tests — a simple counter or `${role}-${Date.now()}` is fine) and return 200 `{ token, url: sfuUrl }`.
- `GET /healthz` → 200 `{ ok: true }` (nice for Railway healthcheck).

## relay/src/index.ts
- Read env: `PORT` (default 8080), `LIVEKIT_API_KEY` (default 'devkey'), `LIVEKIT_API_SECRET` (default 'secret'), `ROOM_PASSWORD` (required — exit non-zero if unset), `SFU_URL` (default 'ws://localhost:7880').
- `buildServer(...).listen({ port, host: '0.0.0.0' })`. Log via console is fine here (standalone Node service, not the app).

## Tests (TDD — real behavior)
- tokens.test.ts: `buildGrant('publisher', 'r')` → canPublish true / canSubscribe false; `buildGrant('subscriber','r')` → canPublish false / canSubscribe true. `mintToken` returns a non-empty JWT string whose decoded payload (split '.', base64url-decode the middle) contains the expected `video` grant + `sub` identity. (Decode with Buffer, no verify needed.)
- server.test.ts (fastify `app.inject`): 
  - POST /token valid publisher (correct password) → 200, body has token + url === sfuUrl.
  - POST /token valid subscriber → 200.
  - POST /token wrong password → 401 `{error:'bad password'}`.
  - POST /token missing/invalid body (e.g. no room) → 400 `{error:'bad request'}`.
  - GET /healthz → 200.

## livekit configs
- selfhost: `port: 7880`, `rtc: { udp_port: 7882, use_external_ip: true }`, `keys: { devkey: secret }`.
- railway: `port: 7880`, `rtc: { tcp_port: 7881, use_external_ip: true }` (no udp_port/port_range), `keys: { devkey: secret }`.

## docker-compose.yml (self-host)
- service `livekit`: image `livekit/livekit-server:latest`, `command: --config /etc/livekit/livekit.yaml`, mount `./livekit.selfhost.yaml:/etc/livekit/livekit.yaml:ro`, ports 7880/7881/7882/udp.
- service `token`: build `.` (the relay Dockerfile), env ROOM_PASSWORD/SFU_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET, port 8080.

## Global constraints
- TypeScript strict. ESM modules. Single quotes. Zod for the request body. Node ≥ 20.
- Keep files focused, one responsibility each.
- Root `npm install` must wire the workspace; `npm test` runs vitest across packages; `npm run build` tsc-builds.

## Verify + commit
1. `npm install` at root (installs workspaces).
2. `npm test` (or `npm -w @soundsbored/relay test`) — all pass.
3. `npx tsc -b` or per-package build — clean.
4. Commit (this is the repo's first commit): `git add -A && git commit -m "feat: monorepo scaffold with contract + relay (LiveKit config + token endpoint)"`.
Do NOT push (controller will handle the first push).

Report: what you built, the livekit-server-sdk API you verified (+ any deviation), test command + full output, files created, concerns → write to `C:\Repos\soundsbored-remote-audio\.superpowers\sdd\m1-report.md`. Reply with status + commit SHA + test summary + report path.
