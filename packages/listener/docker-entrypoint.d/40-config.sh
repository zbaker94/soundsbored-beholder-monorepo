#!/bin/sh
# Regenerate the runtime config from env vars on container start.
# Runs via nginx:alpine's /docker-entrypoint.d/ hook before nginx launches.
#
# A present key is operator-locked: the app shows it read-only ("set by host").
# tokenEndpoint is emitted whenever SET (even empty — empty means same-origin,
# a relative /token). room is emitted only when NON-empty (an empty room is
# meaningless, so it stays editable). Password is never injected.
set -eu

CONFIG=/usr/share/nginx/html/config.js

# JSON-string-escape backslashes and double quotes.
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

{
  printf 'window.__SOUNDSBORED__ = {\n'
  if [ "${LISTENER_TOKEN_ENDPOINT+x}" ]; then
    printf '  tokenEndpoint: "%s",\n' "$(esc "$LISTENER_TOKEN_ENDPOINT")"
  fi
  if [ -n "${LISTENER_ROOM:-}" ]; then
    printf '  room: "%s",\n' "$(esc "$LISTENER_ROOM")"
  fi
  printf '};\n'
} > "$CONFIG"

echo "soundsbored-listener: wrote $CONFIG"
cat "$CONFIG"
