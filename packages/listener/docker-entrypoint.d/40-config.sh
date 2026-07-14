#!/bin/sh
# Regenerate the runtime config from env vars on container start.
# Runs via nginx:alpine's /docker-entrypoint.d/ hook before nginx launches.
# Password is intentionally NOT injected — it is user-entered, not baked into
# a self-hostable page. tokenEndpoint may be left empty for a same-origin deploy
# (the core then POSTs to a relative /token).
set -eu

cat > /usr/share/nginx/html/config.js <<EOF
window.__SOUNDSBORED__ = {
  tokenEndpoint: "${LISTENER_TOKEN_ENDPOINT:-}",
  room: "${LISTENER_ROOM:-}"
};
EOF

echo "soundsbored-listener: wrote /config.js (tokenEndpoint='${LISTENER_TOKEN_ENDPOINT:-}', room='${LISTENER_ROOM:-}')"
