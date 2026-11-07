#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_SETTINGS="$REPO_ROOT/.deploy.env"

usage() {
  cat <<'USAGE'
Usage:
  npm run deploy -- ip
  npm run deploy -- ip-https
  npm run deploy -- domain [domain]

Configure the SSH target and deployment settings in .deploy.env first.
ip-https serves https://<public IP>/ with a six-day Let's Encrypt IP
certificate that renews automatically; it needs inbound TCP 80 and 443 and a
valid certificate email, but no domain.
Set DEPLOY_SYNC=1 in .deploy.env to also install the family sync service
(HTTPS modes only, needs Node.js 22.18+ on the server); the family key is
printed once on first install.
Domain mode requires completed ICP filing for mainland hosting, DNS pointing to
the ECS instance, inbound TCP ports 80 and 443, and a valid certificate email.
USAGE
}

die() {
  printf 'deploy: %s\n' "$1" >&2
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ -f "$DEPLOY_SETTINGS" ]] || die "Missing .deploy.env; copy .deploy.env.example and fill in the server settings."
# shellcheck disable=SC1090
set -a
source "$DEPLOY_SETTINGS"
set +a

DEPLOY_MODE="${1:-ip}"
DEPLOY_DOMAIN="${2:-${DEPLOY_DOMAIN:-}}"
LETSENCRYPT_EMAIL="${3:-${LETSENCRYPT_EMAIL:-}}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_PUBLIC_IP="${DEPLOY_PUBLIC_IP:-}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/var/www/babytime}"
DEPLOY_HTTP_PORT="${DEPLOY_HTTP_PORT:-80}"
DEPLOY_ROOT="${DEPLOY_ROOT%/}"

case "$DEPLOY_MODE" in
  ip|ip-https|domain) ;;
  *) die "Mode must be 'ip', 'ip-https' or 'domain'." ;;
esac

[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || die "DEPLOY_HOST must be an IP address or SSH host name."
[[ "$DEPLOY_USER" =~ ^[A-Za-z_][A-Za-z0-9._-]*$ ]] || die "DEPLOY_USER contains unsupported characters."
[[ "$DEPLOY_ROOT" =~ ^/var/www/[A-Za-z0-9._/-]+$ ]] || die "DEPLOY_ROOT must be a dedicated path under /var/www."
case "/$DEPLOY_ROOT/" in
  */../*) die "DEPLOY_ROOT cannot contain '..' path segments." ;;
esac
[[ "$DEPLOY_HTTP_PORT" =~ ^[0-9]{1,5}$ ]] || die "DEPLOY_HTTP_PORT must be a port number from 1 to 65535."
((10#$DEPLOY_HTTP_PORT >= 1 && 10#$DEPLOY_HTTP_PORT <= 65535)) || die "DEPLOY_HTTP_PORT must be a port number from 1 to 65535."

is_ipv4() {
  local candidate="$1"
  local part
  local -a octets
  [[ "$candidate" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS=. read -r -a octets <<< "$candidate"
  [[ "${#octets[@]}" -eq 4 ]] || return 1
  for part in "${octets[@]}"; do
    [[ "$part" =~ ^[0-9]{1,3}$ ]] || return 1
    ((10#$part <= 255)) || return 1
  done
}

if [[ -n "$DEPLOY_PUBLIC_IP" ]]; then
  is_ipv4 "$DEPLOY_PUBLIC_IP" || die "DEPLOY_PUBLIC_IP must be a valid IPv4 address."
elif [[ "$DEPLOY_MODE" == ip* ]]; then
  die "Set DEPLOY_PUBLIC_IP for IP mode."
fi
if [[ "$DEPLOY_MODE" == "ip-https" ]]; then
  ((10#$DEPLOY_HTTP_PORT == 80)) || die "ip-https mode needs DEPLOY_HTTP_PORT=80 for certificate validation."
fi

if [[ "$DEPLOY_MODE" == "domain" ]]; then
  [[ "$DEPLOY_DOMAIN" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || die "Provide a plain domain name, such as your-domain.com."
fi
if [[ "$DEPLOY_MODE" != "ip" ]]; then
  [[ "$LETSENCRYPT_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Set a valid LETSENCRYPT_EMAIL in .deploy.env for HTTPS modes."
  [[ ! "$LETSENCRYPT_EMAIL" =~ @example\.(com|net|org)$ ]] || die "LETSENCRYPT_EMAIL in .deploy.env is still a placeholder; Let's Encrypt rejects example.com, so set your real email address."
fi

for command_name in npm ssh tar; do
  command -v "$command_name" >/dev/null 2>&1 || die "Required local command is missing: $command_name"
done

SSH_TARGET="$DEPLOY_USER@$DEPLOY_HOST"
printf 'Building BabyTime for %s deployment...\n' "$DEPLOY_MODE"
(cd "$REPO_ROOT" && npm ci && npm run build)
[[ -f "$REPO_ROOT/dist/index.html" ]] || die "Build did not produce dist/index.html."

LOCAL_PACKAGE="$(mktemp -d "${TMPDIR:-/tmp}/babytime-deploy.XXXXXX")"
cleanup_local() {
  rm -rf -- "$LOCAL_PACKAGE"
}
trap cleanup_local EXIT

mkdir -p "$LOCAL_PACKAGE/dist"
cp -a "$REPO_ROOT/dist/." "$LOCAL_PACKAGE/dist/"
cp "$REPO_ROOT/scripts/deploy-remote.sh" "$LOCAL_PACKAGE/deploy-remote.sh"
if [[ "${DEPLOY_SYNC:-0}" == "1" ]]; then
  [[ "$DEPLOY_MODE" != "ip" ]] || die "DEPLOY_SYNC=1 needs ip-https or domain mode; the family key must not travel over HTTP."
  cp "$REPO_ROOT/server/sync.ts" "$LOCAL_PACKAGE/sync.ts"
fi

printf 'Preparing upload to %s...\n' "$SSH_TARGET"
REMOTE_STAGE="$(ssh "$SSH_TARGET" 'mktemp -d /tmp/babytime-deploy.XXXXXX')"
[[ "$REMOTE_STAGE" =~ ^/tmp/babytime-deploy\.[A-Za-z0-9]+$ ]] || die "Could not create a safe remote staging directory."
tar -C "$LOCAL_PACKAGE" -czf - . | ssh "$SSH_TARGET" "mkdir -p '$REMOTE_STAGE' && tar -xzf - -C '$REMOTE_STAGE'"

printf 'Deploying in %s mode to %s...\n' "$DEPLOY_MODE" "$SSH_TARGET"
if ssh -tt "$SSH_TARGET" "sudo bash '$REMOTE_STAGE/deploy-remote.sh' '$DEPLOY_MODE' '$DEPLOY_ROOT' '$DEPLOY_PUBLIC_IP' '$DEPLOY_DOMAIN' '$LETSENCRYPT_EMAIL' '$REMOTE_STAGE' '$DEPLOY_HTTP_PORT'"; then
  ssh "$SSH_TARGET" "rm -rf -- '$REMOTE_STAGE'"
else
  printf 'Deployment failed; remote staging files were kept at %s for inspection.\n' "$REMOTE_STAGE" >&2
  exit 1
fi
