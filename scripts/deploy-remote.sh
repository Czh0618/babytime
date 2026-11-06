#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:?mode is required}"
APP_ROOT="${2:?deployment root is required}"
PUBLIC_IP="${3:-}"
DOMAIN="${4:-}"
EMAIL="${5:-}"
STAGE="${6:?staging path is required}"
HTTP_PORT="${7:-80}"

die() {
  printf 'remote deploy: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || die "Run this script through sudo."
case "$MODE" in
  ip|ip-https|domain) ;;
  *) die "Mode must be 'ip', 'ip-https' or 'domain'." ;;
esac
[[ "$APP_ROOT" =~ ^/var/www/[A-Za-z0-9._/-]+$ ]] || die "Invalid deployment root."
case "/$APP_ROOT/" in
  */../*) die "Deployment root cannot contain '..' path segments." ;;
esac
[[ "$STAGE" =~ ^/tmp/babytime-deploy\.[A-Za-z0-9]+$ ]] || die "Invalid staging path."
[[ -f "$STAGE/dist/index.html" ]] || die "Uploaded build is incomplete."
[[ "$HTTP_PORT" =~ ^[0-9]{1,5}$ ]] || die "Invalid HTTP port."
((10#$HTTP_PORT >= 1 && 10#$HTTP_PORT <= 65535)) || die "Invalid HTTP port."

if [[ "$MODE" == ip* ]]; then
  [[ "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "Invalid public IPv4 address."
  IFS=. read -r -a octets <<< "$PUBLIC_IP"
  for octet in "${octets[@]}"; do
    ((10#$octet <= 255)) || die "Invalid public IPv4 address."
  done
else
  [[ "$DOMAIN" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || die "Invalid domain name."
fi
if [[ "$MODE" != "ip" ]]; then
  [[ "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Invalid certificate email."
fi
if [[ "$MODE" == "ip-https" ]]; then
  ((10#$HTTP_PORT == 80)) || die "ip-https mode must serve HTTP on port 80 for certificate validation."
fi

if [[ ! -f /etc/os-release ]]; then
  die "Cannot detect the remote Linux distribution."
fi
# shellcheck disable=SC1091
source /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) die "This script currently supports Ubuntu and Debian only." ;;
esac

package_installed() {
  [[ "$(dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null || true)" == "installed" ]]
}

ensure_packages() {
  local missing=0
  local package_name
  for package_name in "$@"; do
    if ! package_installed "$package_name"; then
      missing=1
    fi
  done
  if [[ "$missing" -eq 1 ]]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
  fi
}

CERTBOT=/snap/bin/certbot
IP_CERT_NAME=babytime-ip

certbot_version() {
  snap list certbot 2>/dev/null | awk 'NR == 2 { print $2 }'
}

# IP certificates need Certbot 5.4+ (--ip-address with webroot). Both HTTPS
# modes use the official snap, which ships the nginx plugin and its own renew
# timer. Mixing it with the distro package leaves a bare `certbot` resolving to
# /usr/bin while snap.certbot.renew.timer uses /snap/bin: two versions share
# /etc/letsencrypt and two timers compete over the same certificates.
certbot_supports_ip() {
  printf '%s\n%s\n' 5.4 "$(certbot_version)" | sort -V -C
}

ensure_snap_certbot() {
  ensure_packages snapd
  snap wait system seed.loaded
  snap list certbot >/dev/null 2>&1 || snap install --classic certbot
  if [[ -x /usr/bin/certbot ]]; then
    printf 'Warning: apt certbot is also installed at /usr/bin/certbot; remove it so a bare `certbot` and certbot.timer do not run the old version.\n' >&2
  fi
  if [[ "$MODE" == "ip-https" ]]; then
    certbot_supports_ip || snap refresh certbot
    certbot_supports_ip || die "Certbot $(certbot_version) is too old for IP certificates; 5.4 or newer is required."
  fi
}

ensure_packages nginx
if [[ "$MODE" != "ip" ]]; then
  ensure_snap_certbot
fi

if [[ -e "$APP_ROOT/current" && ! -L "$APP_ROOT/current" ]]; then
  die "$APP_ROOT/current exists and is not a symlink; move it aside before deploying."
fi

RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-$$"
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"
install -d -m 0755 "$RELEASE_DIR"
cp -a "$STAGE/dist/." "$RELEASE_DIR/"
chmod -R a+rX "$RELEASE_DIR"

NGINX_CONF=/etc/nginx/conf.d/babytime.conf
PREVIOUS_CONF="$STAGE/babytime.conf.previous"
HTTP_CONF="$STAGE/babytime.conf.http"
NEXT_CONF="$STAGE/babytime.conf.next"
HAD_PREVIOUS_CONF=0
if [[ -f "$NGINX_CONF" ]]; then
  cp -a "$NGINX_CONF" "$PREVIOUS_CONF"
  HAD_PREVIOUS_CONF=1
fi

if [[ "$MODE" == ip* ]]; then
  SERVER_NAME="$PUBLIC_IP"
  CERT_DIR="/etc/letsencrypt/live/$IP_CERT_NAME"
else
  SERVER_NAME="$DOMAIN"
  CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
fi
ACME_ROOT="$APP_ROOT/acme"
ACME_LOCATION=""
if [[ "$MODE" == "ip-https" ]]; then
  # Renewals use webroot challenges on port 80, so ip-https always serves them.
  ACME_LOCATION="
    location ^~ /.well-known/acme-challenge/ {
        root $ACME_ROOT;
    }
"
fi

write_http_config() {
  local server_name="$1"
  local http_port="$2"
  cat > "$NEXT_CONF" <<EOF
server {
    listen $http_port;
    server_name $server_name;
    root $APP_ROOT/current;
    index index.html;
${ACME_LOCATION}
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
}

write_https_config() {
  if [[ "$MODE" == "ip-https" ]]; then
    # Keep plain HTTP for ACME renewals and so data saved on the http origin can
    # still be exported; browsers keep http and https storage separate.
    write_http_config "$SERVER_NAME" 80
  else
    cat > "$NEXT_CONF" <<EOF
server {
    listen 80;
    server_name $SERVER_NAME;
    return 301 https://\$host\$request_uri;
}
EOF
  fi
  cat >> "$NEXT_CONF" <<EOF

server {
    listen 443 ssl;
    server_name $SERVER_NAME;
    root $APP_ROOT/current;
    index index.html;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
}

restore_previous_config() {
  if [[ "$HAD_PREVIOUS_CONF" -eq 1 ]]; then
    install -m 0644 "$PREVIOUS_CONF" "$NGINX_CONF"
  else
    rm -f "$NGINX_CONF"
  fi
}

has_certificate() {
  [[ -s "$CERT_DIR/fullchain.pem" && -s "$CERT_DIR/privkey.pem" ]]
}

issue_ip_certificate() {
  install -d -m 0755 "$ACME_ROOT"
  if "$CERTBOT" certonly --webroot -w "$ACME_ROOT" --ip-address "$PUBLIC_IP" \
    --preferred-profile shortlived --cert-name "$IP_CERT_NAME" \
    --keep-until-expiring --non-interactive --agree-tos --email "$EMAIL"; then
    return 0
  fi
  has_certificate || die "Could not obtain an IP certificate (see the Certbot error above); the site stays on HTTP."
  printf 'Warning: certificate renewal failed; keeping the existing certificate.\n' >&2
}

if [[ "$MODE" == "ip" ]]; then
  write_http_config "$PUBLIC_IP" "$HTTP_PORT"
elif has_certificate; then
  write_https_config
else
  write_http_config "$SERVER_NAME" 80
fi

install -d -m 0755 /etc/nginx/conf.d
install -m 0644 "$NEXT_CONF" "$NGINX_CONF"
if ! nginx -t; then
  restore_previous_config
  die "Nginx configuration check failed; the previous site config was restored."
fi

OLD_RELEASE=""
if [[ -L "$APP_ROOT/current" ]]; then
  OLD_RELEASE="$(readlink "$APP_ROOT/current")"
fi
install -d -m 0755 "$APP_ROOT"
ln -sfn "$RELEASE_DIR" "$APP_ROOT/current"

if ! systemctl enable --now nginx || ! systemctl reload nginx; then
  if [[ -n "$OLD_RELEASE" ]]; then
    ln -sfn "$OLD_RELEASE" "$APP_ROOT/current"
  else
    rm -f "$APP_ROOT/current"
  fi
  restore_previous_config
  die "Nginx failed to activate; the prior site config and release were restored."
fi

if [[ "$MODE" != "ip" ]]; then
  if [[ "$MODE" == "ip-https" ]]; then
    issue_ip_certificate
  elif ! has_certificate; then
    "$CERTBOT" certonly --nginx --non-interactive --agree-tos --email "$EMAIL" --domain "$DOMAIN"
  fi

  cp -a "$NGINX_CONF" "$HTTP_CONF"
  write_https_config
  install -m 0644 "$NEXT_CONF" "$NGINX_CONF"
  if ! nginx -t; then
    install -m 0644 "$HTTP_CONF" "$NGINX_CONF"
    nginx -t || restore_previous_config
    die "HTTPS config check failed; the HTTP config was restored."
  fi
  if ! systemctl reload nginx; then
    write_http_config "$SERVER_NAME" 80
    install -m 0644 "$NEXT_CONF" "$NGINX_CONF"
    if nginx -t; then
      systemctl reload nginx || restore_previous_config
    else
      restore_previous_config
    fi
    die "HTTPS activation failed; the HTTP config was restored."
  fi

  install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/babytime-reload-nginx <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
  chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/babytime-reload-nginx
  RENEW_TIMER=snap.certbot.renew.timer
  if systemctl cat "$RENEW_TIMER" >/dev/null 2>&1; then
    systemctl enable --now "$RENEW_TIMER"
  else
    printf 'Warning: %s was not found; configure certificate renewal on this server.\n' "$RENEW_TIMER" >&2
  fi
fi

printf 'Published release: %s\n' "$RELEASE_DIR"
if [[ "$MODE" == "ip" ]]; then
  if [[ "$HTTP_PORT" -eq 80 ]]; then
    printf 'Open: http://%s/\n' "$PUBLIC_IP"
  else
    printf 'Open: http://%s:%s/\n' "$PUBLIC_IP" "$HTTP_PORT"
  fi
else
  printf 'Open: https://%s/\n' "$SERVER_NAME"
fi
