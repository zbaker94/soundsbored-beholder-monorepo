# @soundsbored/foundry

Foundry VTT module — hear a GM's live SoundsBored master mix in Foundry, with
per-player volume and automatic reconnect. A thin shell over
[`@soundsbored/core`](../core); it reimplements no audio logic.

## Install (Foundry v13+)

In Foundry: **Add-on Modules → Install Module → Manifest URL**:

```
https://github.com/zbaker94/soundsbored-remote-audio/releases/latest/download/module.json
```

## Configure (GM)

Enable the module, then in **Game Settings → Configure Settings → SoundsBored:
Beholder** set:

- **Token endpoint** — your relay URL (e.g. the Railway relay), or blank for a
  same-origin relay.
- **Room** — must match the room the SoundsBored app publishes to.
- **Room password** — the shared listen-only password set on the relay.

These are world settings (GM-only to edit). The password is readable by players'
clients by design — it is the shared room password (listen-only) they need to
fetch a token.

## Listen (any player)

Click the **headphones** scene control to open the audio panel, then **Join
audio** (a click is required to unlock browser audio). Adjust your own volume /
mute; both persist per client. The status line shows the live connection state
and rides reconnects automatically.

## Develop

```bash
npm run build -w @soundsbored/foundry   # bundle + assemble dist/
npm test -w @soundsbored/foundry        # unit tests (settings + controller)
```

Release: push a `foundry-vX.Y.Z` tag; CI publishes `module.json` + `module.zip`
to a GitHub Release.
