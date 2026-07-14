#!/usr/bin/env sh
# LiveKit SFU entrypoint for no-UDP hosts (Railway et al.).
#
# The problem: WebRTC media must reach the SFU at the exact host:port LiveKit
# advertises as its ICE candidate. On a PaaS the media port is exposed through a
# TCP proxy that (a) offers no UDP and (b) assigns a RANDOM external port that
# does not equal the container's listen port. LiveKit has no "advertise a
# different external port than I listen on" setting, so we bridge:
#
#   1. Read the external host:port the platform proxy exposes.
#   2. Generate a TCP-only LiveKit config that LISTENS on that external port and
#      ADVERTISES it (node_ip = resolved proxy IP, tcp_port = external port).
#   3. Redirect the container's inbound target port -> that port, because the
#      proxy forwards to a fixed target port, not the random external one.
#      iptables if we have NET_ADMIN; haproxy (userspace) otherwise.
#
# Env (Railway sets RAILWAY_TCP_PROXY_*; other hosts set SFU_EXTERNAL_*):
#   RAILWAY_TCP_PROXY_DOMAIN / SFU_EXTERNAL_HOST   external hostname of the proxy
#   RAILWAY_TCP_PROXY_PORT   / SFU_EXTERNAL_TCP_PORT  external (public) TCP port
#   SFU_LISTEN_TARGET_PORT   the container port the proxy forwards to (default 7881)
#   LIVEKIT_API_KEY / LIVEKIT_API_SECRET   the SFU keys (must match the relay)
set -eu

EXT_HOST="${SFU_EXTERNAL_HOST:-${RAILWAY_TCP_PROXY_DOMAIN:-}}"
EXT_PORT="${SFU_EXTERNAL_TCP_PORT:-${RAILWAY_TCP_PROXY_PORT:-}}"
TARGET_PORT="${SFU_LISTEN_TARGET_PORT:-7881}"
: "${LIVEKIT_API_KEY:?set LIVEKIT_API_KEY}"
: "${LIVEKIT_API_SECRET:?set LIVEKIT_API_SECRET}"

if [ -z "$EXT_HOST" ] || [ -z "$EXT_PORT" ]; then
  echo "livekit-bridge: need RAILWAY_TCP_PROXY_DOMAIN/PORT or SFU_EXTERNAL_HOST/TCP_PORT" >&2
  exit 1
fi

# node_ip must be an IP literal — resolve the proxy hostname (getent, then nslookup).
EXT_IP="$(getent hosts "$EXT_HOST" 2>/dev/null | awk '{print $1; exit}')"
if [ -z "$EXT_IP" ]; then
  EXT_IP="$(nslookup "$EXT_HOST" 2>/dev/null | awk '/^Address: /{print $2; exit}')"
fi
[ -z "$EXT_IP" ] && EXT_IP="$EXT_HOST" # assume it was already an IP

cat > /etc/livekit/livekit.gen.yaml <<EOF
port: 7880
rtc:
  tcp_port: ${EXT_PORT}
  use_external_ip: false
  node_ip: ${EXT_IP}
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
EOF

echo "livekit-bridge: advertising ${EXT_IP}:${EXT_PORT} (ICE-TCP); listening on ${EXT_PORT}"

# The proxy forwards inbound to TARGET_PORT, but LiveKit now listens on EXT_PORT.
# Bridge TARGET_PORT -> EXT_PORT unless they already match.
if [ "$TARGET_PORT" != "$EXT_PORT" ]; then
  if iptables -t nat -A PREROUTING -p tcp --dport "$TARGET_PORT" -j REDIRECT --to-ports "$EXT_PORT" 2>/dev/null; then
    echo "livekit-bridge: iptables redirect ${TARGET_PORT} -> ${EXT_PORT}"
  else
    echo "livekit-bridge: no NET_ADMIN; haproxy ${TARGET_PORT} -> 127.0.0.1:${EXT_PORT}"
    cat > /tmp/haproxy.cfg <<EOF
defaults
  mode tcp
  timeout connect 5s
  timeout client 1h
  timeout server 1h
frontend ingress
  bind :${TARGET_PORT}
  default_backend sfu
backend sfu
  server s1 127.0.0.1:${EXT_PORT}
EOF
    haproxy -f /tmp/haproxy.cfg &
  fi
fi

exec /livekit-server --config /etc/livekit/livekit.gen.yaml
