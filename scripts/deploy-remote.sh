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

SYNC_UNIT=/etc/systemd/system/babytime-sync.service
SYNC_ENV=/etc/babytime-sync.env
SYNC_KEY_CREATED=0

# Family sync (docs/SYNC.md): only installed when deploy.sh uploads server/sync.ts
# (DEPLOY_SYNC=1). Once installed, later deploys keep the /sync/ proxy.
install_sync() {
  [[ "$MODE" != "ip" ]] || die "Sync needs HTTPS; deploy with ip-https or domain mode."
  command -v node >/dev/null 2>&1 || die "Sync needs Node.js 22.18+ on the server (node:sqlite and .ts support); install it first."
  printf '%s\n%s\n' 22.18.0 "$(node -p process.versions.node)" | sort -V -C ||
    die "Sync needs Node.js 22.18+; the server has $(node -v)."
  id babytime-sync >/dev/null 2>&1 ||
    useradd --system --home-dir /var/lib/babytime --shell /usr/sbin/nologin babytime-sync
  install -d -m 0750 -o babytime-sync -g babytime-sync /var/lib/babytime
  # P7.2：照片原片与缩略图存 ECS 本机磁盘，服务用户对目录可写。
  install -d -m 0750 -o babytime-sync -g babytime-sync /var/lib/babytime/media
  install -d -m 0755 /opt/babytime-sync
  install -m 0644 "$STAGE/sync.ts" /opt/babytime-sync/sync.ts
  if [[ ! -s "$SYNC_ENV" ]]; then
    (umask 077 && printf 'BABYTIME_SYNC_KEY=%s\n' "$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')" > "$SYNC_ENV")
    SYNC_KEY_CREATED=1
  fi
  cat > "$SYNC_UNIT" <<UNIT
[Unit]
Description=BabyTime family sync
After=network.target

[Service]
User=babytime-sync
EnvironmentFile=$SYNC_ENV
Environment=BABYTIME_SYNC_DB=/var/lib/babytime/sync.db
Environment=BABYTIME_MEDIA_DIR=/var/lib/babytime/media
ExecStart=$(command -v node) /opt/babytime-sync/sync.ts
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/babytime

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable babytime-sync >/dev/null
  systemctl restart babytime-sync
}

if [[ -f "$STAGE/sync.ts" ]]; then
  install_sync
fi
SYNC_LOCATION=""
if [[ -f "$SYNC_UNIT" ]]; then
  # 最长前缀匹配：/sync/media/ 优先于 /sync/，照片流式上传不落 Nginx 临时缓冲。
  SYNC_LOCATION="
    location /sync/media/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_buffering off;
        client_max_body_size 20m;
    }

    location /sync/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        client_max_body_size 1m;
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
${SYNC_LOCATION}
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

cert_expiry() {
  openssl x509 -enddate -noout -in "$CERT_DIR/fullchain.pem" 2>/dev/null |
    sed -n 's/^notAfter=//p'
}

# 剩余有效期（天）。ip-https 用 6 天短证书，续期失败时必须让运维看见「还剩几天」，
# 不然容易等到过期才发现 HTTPS 掉了（多设备同步也要求 HTTPS）。
cert_days_left() {
  local end end_epoch now
  end=$(cert_expiry)
  [[ -n "$end" ]] || return 0
  end_epoch=$(date -d "$end" +%s 2>/dev/null) || return 0
  [[ "$end_epoch" =~ ^[0-9]+$ ]] || return 0
  now=$(date +%s)
  printf '%s' "$(( (end_epoch - now) / 86400 ))"
}

# 续期失败不阻断发布（应用代码该上线还是上线），但要把剩余时间与补救命令说清楚。
report_renewal_failure() {
  local left end
  left=$(cert_days_left)
  end=$(cert_expiry)
  printf 'Warning: certificate renewal failed; keeping the existing certificate' >&2
  if [[ -n "$end" && -n "$left" ]]; then
    printf ' (expires %s, about %s day(s) left).\n' "$end" "$left" >&2
  elif [[ -n "$end" ]]; then
    printf ' (expires %s).\n' "$end" >&2
  else
    printf '.\n' >&2
  fi
  if [[ -n "$left" && "$left" -le 1 ]]; then
    printf 'URGENT: HTTPS stops working when this certificate expires, and multi-device sync needs HTTPS.\n' >&2
  else
    printf 'The snap renew timer retries automatically; to retry now:\n' >&2
  fi
  printf '  sudo /snap/bin/certbot renew --cert-name %s -v\n' "$IP_CERT_NAME" >&2
}

issue_ip_certificate() {
  install -d -m 0755 "$ACME_ROOT"
  if "$CERTBOT" certonly --webroot -w "$ACME_ROOT" --ip-address "$PUBLIC_IP" \
    --preferred-profile shortlived --cert-name "$IP_CERT_NAME" \
    --keep-until-expiring --non-interactive --agree-tos --email "$EMAIL"; then
    return 0
  fi
  has_certificate || die "Could not obtain an IP certificate (see the Certbot error above); the site stays on HTTP."
  report_renewal_failure
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
if [[ "$SYNC_KEY_CREATED" -eq 1 ]]; then
  # Printed once to the terminal only; it stays readable by root in $SYNC_ENV.
  printf '\nFamily sync key (save it in a password manager, enter it on each device):\n  %s\n' \
    "$(sed -n 's/^BABYTIME_SYNC_KEY=//p' "$SYNC_ENV")"
fi
if [[ -f "$SYNC_UNIT" ]]; then
  curl -fsS -H 'X-Forwarded-Proto: https' http://127.0.0.1:8787/sync/health >/dev/null 2>&1 &&
    printf 'Sync service: healthy\n' ||
    printf 'Warning: sync service health check failed; see journalctl -u babytime-sync.\n' >&2
fi
