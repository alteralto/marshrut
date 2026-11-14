#!/usr/bin/env bash
# One-time setup of a clean Ubuntu 24.04 server: Docker, Caddy (HTTPS), the app.
# Run as root from the unpacked release in /opt/marshrut:
#   EDITOR_TOKEN=... READER_TOKEN=... bash deploy/setup.sh [domain]
# Without a domain the server answers at https://<ip-with-dashes>.sslip.io
set -euo pipefail
cd "$(dirname "$0")/.."

: "${EDITOR_TOKEN:?set EDITOR_TOKEN}"
: "${READER_TOKEN:?set READER_TOKEN}"
ip=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
domain=${1:-${ip//./-}.sslip.io}

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 caddy ufw

ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# the app listens on localhost only; Caddy terminates HTTPS in front of it
umask 077
cat > .env <<EOF
PORT=127.0.0.1:8787
EDITOR_TOKEN=$EDITOR_TOKEN
READER_TOKEN=$READER_TOKEN
SECURE_COOKIES=1
EOF

cat > /etc/caddy/Caddyfile <<EOF
$domain {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
EOF
systemctl reload caddy || systemctl restart caddy

docker compose up --build -d
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && break
  sleep 5
done
curl -fsS http://127.0.0.1:8787/health && echo
echo "ready: https://$domain"
