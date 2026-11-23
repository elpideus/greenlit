#!/bin/sh
# Runs the Cloudflare Tunnel when a token is set (TUNNEL_TOKEN, from CLOUDFLARE_TUNNEL_TOKEN in .env);
# without one the service waits quietly, so `docker compose up` works the same with or without Cloudflare.
if [ -z "$TUNNEL_TOKEN" ]; then
  echo "greenlit-tunnel: no CLOUDFLARE_TUNNEL_TOKEN in .env, so the Cloudflare Tunnel is off."
  trap 'exit 0' TERM INT
  while :; do
    sleep 3600 &
    wait $!
  done
fi
exec cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:20241 run
