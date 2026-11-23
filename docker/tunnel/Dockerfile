# Greenlit's Cloudflare Tunnel: Cloudflare's cloudflared with a small start script, so the tunnel connects when
# a token is set and the service simply idles when there is none (compose.yaml runs it without a profile).
#   docker build -t greenlit-tunnel docker/tunnel

FROM cloudflare/cloudflared:2026.11.0 AS cloudflared

FROM alpine:3.24
# cloudflared is a static Go binary; Alpine adds the shell the start script and the health check need.
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY start.sh /usr/local/bin/greenlit-tunnel
RUN chmod 0755 /usr/local/bin/greenlit-tunnel && cloudflared --version
# cloudflared's own image runs as this user too.
USER 65532:65532
# Ready = at least one connection to Cloudflare is up (or no token: nothing to be ready for).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD test -z "$TUNNEL_TOKEN" || wget -qO /dev/null http://127.0.0.1:20241/ready
ENTRYPOINT ["/usr/local/bin/greenlit-tunnel"]
