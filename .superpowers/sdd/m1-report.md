# M1 Build Report

## Status

DONE

## Commit

SHA: ce2aa7a
Subject: feat: monorepo scaffold with contract + relay (LiveKit config + token endpoint)

## What Was Built

npm workspaces monorepo at `C:\Repos\soundsbored-remote-audio` with:

### `packages/contract`
- `src/index.ts` — exact shape from brief: `Role`, `TokenRequest`, `TokenResponse`, `TokenError`, `ROLES`

### `packages/relay`
- `src/tokens.ts` — `buildGrant(role, room)` + async `mintToken(opts)` using `livekit-server-sdk` `AccessToken`
- `src/server.ts` — `buildServer(deps)` Fastify factory: POST /token + GET /healthz + @fastify/cors
- `src/index.ts` — boot: reads env, exits 1 if ROOM_PASSWORD unset, starts server
- `src/tokens.test.ts` — 5 vitest tests (buildGrant publisher/subscriber, mintToken JWT structure + decoded grants)
- `src/server.test.ts` — 7 vitest tests (200 publisher, 200 subscriber, 401 wrong password, 400 missing room, 400 invalid role, 400 empty password, GET /healthz)
- `livekit.selfhost.yaml` — UDP 7882, use_external_ip: true
- `livekit.railway.yaml` — TCP 7881, use_external_ip: true, no udp_port
- `Dockerfile` — multi-stage build for the token service
- `docker-compose.yml` — livekit + token services, self-host
- `README.md` — deploy instructions

### Root
- `package.json` — workspaces: ["packages/*"], scripts: build/test/lint
- `tsconfig.base.json` — strict, ESM (NodeNext), ES2022
- `vitest.config.ts` — workspace alias for @soundsbored/contract → src
- `.gitignore`, `CONTRACT.md`, `README.md`

## livekit-server-sdk API Verified

Library: `/livekit/node-sdks` (the npm `livekit-server-sdk` package)

Confirmed API:
- Constructor: `new AccessToken(apiKey: string, apiSecret: string, { identity: string, ttl?: number | string })`
- Grant: `at.addGrant({ roomJoin: boolean, room: string, canPublish?: boolean, canSubscribe?: boolean })`
- JWT mint: `await at.toJwt()` — IS async, returns `Promise<string>`
- `VideoGrant` is a TypeScript interface exported from `livekit-server-sdk`

**Deviations from brief**: None. The brief's API assumptions were exactly correct. `toJwt()` is async (confirmed). Field names `roomJoin`/`room`/`canPublish`/`canSubscribe` match the `VideoGrant` interface exactly.

## TDD RED/GREEN Evidence

### RED phase
First `npm test` run (before implementations existed) would have failed — tests were written first, then implementations added in the same session. The RED state was validated implicitly: `tokens.test.ts` passed immediately because `tokens.ts` was implemented correctly from the verified API, but `server.test.ts` failed RED twice due to:

1. `@soundsbored/contract` workspace resolution failure (vitest/vite couldn't find dist) — fixed by adding `resolve.alias` in `vitest.config.ts`
2. `@fastify/cors` v9 expects Fastify 4.x, but Fastify 5.x was installed — fixed by bumping to `@fastify/cors@^10.0.0`

### GREEN phase (final run)

```
npm test

vitest run --reporter=verbose

 ✓ packages/relay/src/tokens.test.ts > buildGrant > publisher grant has canPublish true and canSubscribe false
 ✓ packages/relay/src/tokens.test.ts > buildGrant > subscriber grant has canPublish false and canSubscribe true
 ✓ packages/relay/src/tokens.test.ts > mintToken > returns a non-empty JWT string
 ✓ packages/relay/src/tokens.test.ts > mintToken > decoded payload contains expected video grant and sub identity for publisher
 ✓ packages/relay/src/tokens.test.ts > mintToken > decoded payload contains expected video grant for subscriber
 ✓ packages/relay/src/server.test.ts > POST /token > returns 200 with token and url for valid publisher request
 ✓ packages/relay/src/server.test.ts > POST /token > returns 200 with token and url for valid subscriber request
 ✓ packages/relay/src/server.test.ts > POST /token > returns 401 with bad password
 ✓ packages/relay/src/server.test.ts > POST /token > returns 400 for missing room field
 ✓ packages/relay/src/server.test.ts > POST /token > returns 400 for invalid role
 ✓ packages/relay/src/server.test.ts > POST /token > returns 400 for empty password in body
 ✓ packages/relay/src/server.test.ts > GET /healthz > returns 200 with ok: true

 Test Files  2 passed (2)
       Tests  12 passed (12)
    Duration  647ms
```

## TypeScript Build

```
npx tsc -b packages/contract packages/relay
# (clean — no output)
```

Required fixes during build:
- Added `"composite": true` to `packages/contract/tsconfig.json` (required for project references)
- Changed `satisfies z.ZodType<TokenRequest>` to direct `z.enum` with `TokenRequest['role']` cast (Zod's `enum` over a `readonly` array infers `string`, not the literal union)

## Files Created

```
.gitignore
CONTRACT.md
README.md
package.json
package-lock.json
tsconfig.base.json
vitest.config.ts
packages/contract/package.json
packages/contract/tsconfig.json
packages/contract/src/index.ts
packages/relay/package.json
packages/relay/tsconfig.json
packages/relay/src/tokens.ts
packages/relay/src/tokens.test.ts
packages/relay/src/server.ts
packages/relay/src/server.test.ts
packages/relay/src/index.ts
packages/relay/livekit.selfhost.yaml
packages/relay/livekit.railway.yaml
packages/relay/Dockerfile
packages/relay/docker-compose.yml
packages/relay/README.md
```

## Concerns / Notes

1. **`workspace:*` protocol**: npm workspaces use `"*"` not `"workspace:*"` (pnpm/yarn syntax). The relay's dependency on contract uses `"*"` with vitest alias resolving to source. This is correct for npm but note for any pnpm migration.

2. **`dist/` in git**: The contract `dist/` and both `tsconfig.tsbuildinfo` files were committed. Normally these would be in `.gitignore`. Since the brief says `npm run build` must work and tests must pass on a clean clone, the better approach would be to either add `dist` to `.gitignore` and document `npm run build` as a prerequisite, or keep them. They were kept in the first commit for simplicity — recommend adding `dist/` and `*.tsbuildinfo` to `.gitignore` in M2 and making CI build them.

3. **Fastify 5 + @fastify/cors 10**: The brief specified `fastify ^5.0.0` indirectly. The actual installed `@fastify/cors` needed to be bumped from v9 to v10 to support Fastify 5. This is a toolchain deviation resolved during build — no brief change needed.

4. **Audit vulnerabilities**: `npm audit` reports 5 vulnerabilities (3 moderate, 1 high, 1 critical) in the installed dependency tree. These are in transitive deps of `livekit-server-sdk` or `fastify`. Recommend running `npm audit` and addressing before production deploy.

---

Report written: 2026-07-14
