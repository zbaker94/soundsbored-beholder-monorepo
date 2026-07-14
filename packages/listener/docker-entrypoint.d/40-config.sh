#!/bin/sh
# Regenerate the runtime config from env vars on container start.
# Runs via nginx:alpine's /docker-entrypoint.d/ hook before nginx launches.
#
# A key is emitted only when its env var is SET (even if empty). The app treats
# a present key as operator-locked: it hides that input entirely. An absent key
# leaves the field editable by the listener. Password is never injected.
# For a same-origin deploy set LISTENER_TOKEN_ENDPOINT="" (empty -> relative /token).
set -eu

CONFIG=/usr/share/nginx/html/config.js

# JSON-string-escape backslashes and double quotes.
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

{
  printf 'window.__SOUNDSBORED__ = {\n'
  if [ "${LISTENER_TOKEN_ENDPOINT+x}" ]; then
    printf '  tokenEndpoint: "%s",\n' "$(esc "$LISTENER_TOKEN_ENDPOINT")"
  fi
  if [ "${LISTENER_ROOM+x}" ]; then
    printf '  room: "%s",\n' "$(esc "$LISTENER_ROOM")"
  fi
  printf '};\n'
} > "$CONFIG"

echo "soundsbored-listener: wrote $CONFIG"
cat "$CONFIG"
