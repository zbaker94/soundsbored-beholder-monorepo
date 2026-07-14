# M4 — Foundry VTT Module (`packages/foundry`) — Design

> Spec for milestone **M4** of the SoundsBored Remote Audio program. Master plan:
> `sounds-bored/docs/superpowers/plans/2026-07-14-foundry-audio-master-plan.md` (M4).
> Authoritative contract: `CONTRACT.md` (C1–C10).

## Goal

A thin Foundry VTT module that lets a table's players hear the GM's live
SoundsBored master mix over the internet, each with their own volume/mute. The
module is a shell over `@soundsbored/core` (`listener-core`) — it reimplements
**nothing** of subscribe/play/volume/reconnect. It contributes only: Foundry
lifecycle wiring, GM-owned configuration (C6), and a small player-facing control
surface.

## Contract impact

**None.** The module is a pure **C6** consumer (collects
`{ tokenEndpoint, room, password }`, POSTs `/token` with role `subscriber` via
core) and inherits **C7** resilience from core. It touches no server behaviour
and defines no new wire shape. C1–C7 unchanged → **no `CONTRACT.md` or master-plan
edit**. If implementation surfaces a genuine contract change, stop and update
`CONTRACT.md` + the master plan in lockstep before proceeding.

## Package shape

- Name `@soundsbored/foundry`, `private: true`, `type: module`.
- **Vite library build** (mirrors `packages/listener`): bundles `@soundsbored/core`
  + `@soundsbored/contract` **from source** via `resolve.alias` (so it builds
  without a prior `tsc` emit) and bundles `livekit-client` into a single ESM file
  `dist/scripts/soundsbored-foundry.js`. Foundry loads that file via `module.json`
  `esmodules`. A Foundry module ships as plain browser ESM — everything it needs
  must be in the one bundle; no bare `import` of node_modules at runtime.
- TS strict, ESM, single quotes, Node ≥20 — monorepo conventions. `console` is
  permitted here (this is a consumer app surface, not the embedded `core` lib),
  but prefer Foundry's `ui.notifications` for user-facing messages.

## File layout (isolation: pure logic vs Foundry glue)

Mirrors the listener's `config.ts` (pure, unit-tested) / `main.ts` (glue) split so
the testable logic never depends on Foundry or livekit globals.

| File | Responsibility | Unit-tested |
|------|----------------|-------------|
| `src/constants.ts` | `MODULE_ID = 'soundsbored-audio'`, setting keys | — |
| `src/settings.ts` | Pure: `resolveConfig(get)` → `ListenerConfig \| null` from the three world settings (trim; `null` if any blank). No Foundry imports. | ✅ |
| `src/controller.ts` | `createAudioController(deps)` — wraps `createListener`, owns a hidden `<audio>` element, exposes `join/leave/setVolume/setMuted/onState/getState`. **No Foundry globals**; `createListener` + element factory injectable. | ✅ |
| `src/panel.ts` | `ApplicationV2` subclass: status pill, Join/Leave, volume slider, mute. Thin — delegates all behaviour to the controller. | ❌ (Foundry env) |
| `src/module.ts` | Entry bundled as the esmodule. `init`→register settings; `getSceneControlButtons`→add tool that opens the panel; `Hooks.once('ready')`. Thin glue. | ❌ |
| `module.json` | Manifest (id/title/version/compatibility/esmodules/styles/languages/manifest/download). | — |
| `lang/en.json` | i18n strings (setting names/hints, tool title, panel labels). | — |
| `styles/soundsbored.css` | Panel styling. | — |

`panel.ts` and `module.ts` stay deliberately dumb so the untested Foundry-facing
code carries no logic worth testing; all decisions live in `settings.ts` /
`controller.ts`.

## Settings (C6) — GM-owned config

Registered on the `init` hook via `game.settings.register(MODULE_ID, key, …)`:

- `tokenEndpoint`, `room`, `password` — `type: String`, `scope: 'world'`,
  `config: true`. World-scope settings are editable **only by a GM** in Foundry,
  which satisfies "GM-only settings". They are **readable by every connected
  client**, which is required so each player's browser can mint its own subscriber
  token.
- `volume` (`Number`, `scope: 'client'`, `config: false`, default `1`, range
  `0..1`) and `muted` (`Boolean`, `scope: 'client'`, `config: false`, default
  `false`) — per-player, persisted across reloads so "own volume" sticks.

### Security note — password visibility

`password` is a **world** setting, so its value is synced to every player's client
(readable via `game.settings.get`, and present in the settings payload). This is
acceptable for the threat model: `password` is the single **shared room password**
(C4/C6) the operator already distributes to every listener — it is not a per-user
secret and grants only subscriber (listen-only) access (C3). We do **not** attempt
to hide it from players; doing so would be false security and would break the
players' own token fetch. Documented here so the choice is explicit, not accidental.

## Lifecycle & flow

1. **`init`** — register the five settings above.
2. **`getSceneControlButtons`** — Foundry **v13** passes an object keyed by control
   name. Add a control/tool "SoundsBored Audio" (FontAwesome headphones icon),
   available to **all** users (players must reach it). Activating the tool opens the
   panel.
3. **Panel** (`ApplicationV2`): a status pill bound to `listener.onState`
   (`connecting`/`live`/`reconnecting`/`disconnected`), a **Join / Leave** button, a
   volume slider (0..1), a mute toggle.
   - **Join** click is the browser **enable-audio gesture**: it calls
     `controller.join()` → `listener.connect()`, then `audio.play()` to unlock
     playback (autoplay policy requires a user gesture). This is the only place
     audio starts.
   - Volume slider → `controller.setVolume` (→ `listener.setVolume`, persisted to the
     client `volume` setting). Mute toggle likewise.
4. **Config unset** — if `resolveConfig` returns `null` (GM hasn't filled the
   settings), the panel shows "The GM hasn't configured SoundsBored audio yet" and
   disables Join. A GM additionally sees a pointer to open module settings.
5. **Connect errors** — mapped like the listener: `TokenFetchError` with `401` →
   "Wrong password"; other statuses → a generic "Couldn't connect" — surfaced via
   `ui.notifications.error`. On failure the controller leaves cleanly.

## Resilience (C7) — inherited, zero reimplementation

All reconnect/token-refresh/state logic lives in `core`. A forced relay restart
mid-session → livekit-client auto-reconnect → `core` re-attaches the resubscribed
track → the panel pill moves `reconnecting` → `live` and audio resumes. The module
adds no reconnect code; it only *renders* `listener.onState`.

## Testing (TDD where practical)

- `settings.test.ts` — `resolveConfig`: returns a `ListenerConfig` when all three
  present and non-blank; `null` when any is missing/blank/whitespace; trims values.
- `controller.test.ts` — inject a fake `createListener` + fake `<audio>`:
  - `join()` calls `connect`, `attach(audio)`, applies current volume + mute, then
    plays; propagates and surfaces connect errors, then leaves.
  - `leave()` calls `disconnect`.
  - `setVolume` clamps 0..1 and forwards; `setMuted` forwards.
  - state subscription surfaces core state changes to a subscriber.
- `panel.ts` / `module.ts` — not unit-tested (require the Foundry runtime); kept
  thin enough that a live install (the M4 gate) is the verification.

## Build & release

- `vite.config.ts` — library mode: `build.lib` entry `src/module.ts`, `formats:
  ['es']`, single output `scripts/soundsbored-foundry.js`; `resolve.alias` for
  `@soundsbored/core` + `@soundsbored/contract` → their `src` (as listener does).
  `livekit-client` is bundled (not externalized).
- `npm run build` (in the package): `tsc --noEmit` typecheck + `vite build`, then a
  small assemble step copies `module.json`, `lang/`, `styles/` alongside `scripts/`
  into `dist/` and zips `dist/` → `module.zip` (the exact tree Foundry installs).
- `module.json`: `id: 'soundsbored-audio'`, `title`, `version`,
  `compatibility.minimum: '13'` (+ `verified`), `esmodules:
  ['scripts/soundsbored-foundry.js']`, `styles: ['styles/soundsbored.css']`,
  `languages: [{ lang: 'en', name: 'English', path: 'lang/en.json' }]`,
  `manifest: '…/releases/latest/download/module.json'`, `download:
  '…/releases/download/<tag>/module.zip'`.
- **CI** — `.github/workflows/foundry-release.yml` (repo root; monorepo): on tag
  `foundry-v*`, `npm ci`, build the module, `download` URL rewritten to the tagged
  release, upload `module.json` + `module.zip` as Release assets. `manifest`
  resolves to `releases/latest/download/module.json`, so a static Foundry manifest
  URL always tracks the latest release.

## M4 gate mapping

| Gate requirement | Satisfied by |
|---|---|
| Installs in Foundry from the manifest URL | `module.json` + GitHub Release asset (CI) |
| A player hears the mix over the internet (Railway relay) | Panel Join → `core` connect against `tokenEndpoint` pointing at the Railway relay |
| Own volume works | Volume slider → `controller.setVolume` → `core`, persisted client-scope |
| Survives a reconnect blip | `core` C7 auto-reconnect; pill shows `reconnecting`→`live`, audio resumes |

## Local validation (before Railway)

Host-browser dockerized backend, from `packages/relay`:

```
$env:ROOM_PASSWORD="test"
docker compose -f docker-compose.yml -f docker-compose.localhost.yml up -d --build
```

Foundry settings: tokenEndpoint `http://localhost:8080`, room `world1`, password
`test`. Reconnect blip: `docker compose restart livekit` → pill `reconnecting`→`live`,
audio resumes.

## Out of scope (M4)

Token-refresh polish, per-listener mute polish, macOS publish probe, and setup docs
are **M5**. This milestone ships a working, installable module and the CI that
releases it.
