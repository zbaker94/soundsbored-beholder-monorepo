# @soundsbored/listener

Standalone self-host web listener for SoundsBored remote audio — a thin shell
over [`@soundsbored/core`](../core). "Beholder" theme (matches the SoundsBored app).

## Develop

```bash
npm -w @soundsbored/listener run dev      # vite dev on :5173
npm -w @soundsbored/listener run build    # typecheck + static build to dist/
```

Aliases `@soundsbored/core` + `@soundsbored/contract` to source, so no prior
`tsc` emit is needed.

## Configure

Each listener needs `{ tokenEndpoint, room, password }` (Shared Contract C6):
- **In the UI** — fields persist to `localStorage`.
- **Server-set** (Docker) — a `LISTENER_*` var becomes a key in
  `window.__SOUNDSBORED__` (`/config.js`), and the app shows that field
  **read-only** ("set by host") — operator config, informational, not editable.
  Unset vars stay editable. Password is never server-injected.
- `LISTENER_TOKEN_ENDPOINT` is applied even when empty (empty = same-origin,
  a relative `/token`). `LISTENER_ROOM` is applied only when non-empty (an empty
  room stays editable).

## Docker (self-host, runtime env config)

Build from the **repo root** (the workspace build needs core + contract sources):

```bash
docker build -f packages/listener/Dockerfile -t soundsbored-listener .

docker run -p 8080:80 \
  -e LISTENER_TOKEN_ENDPOINT="https://your-relay.example.com" \
  -e LISTENER_ROOM="the-session" \
  soundsbored-listener
```

`config.js` is regenerated from `LISTENER_*` env on each container start
(`docker-entrypoint.d/40-config.sh`) and served `no-store`. nginx serves the
static build with SPA fallback.

| Env var                   | Purpose                                  |
|---------------------------|------------------------------------------|
| `LISTENER_TOKEN_ENDPOINT` | Host-set token endpoint, read-only (empty = same-origin) |
| `LISTENER_ROOM`           | Host-set room, read-only (unset/empty = listener-editable) |
