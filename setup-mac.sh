#!/bin/bash
# One-step install for AoS Coach on a Mac (also works on Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/felipegarzonc/7kingdomslabs/claude/vibrant-goldberg-10cise/aos-coach/setup-mac.sh | bash
#
# Installs into ~/aos-coach: a private copy of Node (only if yours is missing
# or older than 22), the app, and the army data. No admin password needed.
# Run it again to update; your lists, games, books and .env are kept.
# Afterwards, start the app by double-clicking ~/aos-coach/Start AoS Coach.command

set -euo pipefail

REPO="felipegarzonc/7kingdomslabs"
BRANCH="${AOS_BRANCH:-claude/vibrant-goldberg-10cise}"
HOME_DIR="${AOS_HOME:-$HOME/aos-coach}"
APP="$HOME_DIR/app"
NODE_VERSION="22.22.0"
PORT="${PORT:-8787}"

say() { printf '\n\033[1;31m▶\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

mkdir -p "$HOME_DIR"
cd "$HOME_DIR"

# Keep a copy of everything in a log, and say which step failed.
LOG="$HOME_DIR/install.log"
exec > >(tee "$LOG") 2>&1
STEP="starting"
trap 'printf "\n\033[1;31mInstall failed\033[0m during: %s\nA full log is in %s — send a screenshot of this window.\n" "$STEP" "$LOG"' ERR
echo "AoS Coach installer — $(date) — $(uname -sm) — macOS $(sw_vers -productVersion 2>/dev/null || echo n/a)"

# ---- Node ----------------------------------------------------------------
STEP="getting Node"
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }
if [ -x "$HOME_DIR/node/bin/node" ]; then export PATH="$HOME_DIR/node/bin:$PATH"; fi
if [ -n "${AOS_FORCE_NODE:-}" ] || ! node_ok; then
  say "Downloading Node $NODE_VERSION (private copy, only for this app)…"
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "Unsupported system $(uname -s)" ;; esac
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; x86_64) arch=x64 ;; *) die "Unsupported processor $(uname -m)" ;; esac
  rm -rf "$HOME_DIR/node"
  mkdir -p "$HOME_DIR/node"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$os-$arch.tar.gz" | tar -xz -C "$HOME_DIR/node" --strip-components=1
  export PATH="$HOME_DIR/node/bin:$PATH"
fi
node_ok || die "Node 22+ is still not available."
echo "Using Node $(node -v)"

# ---- App -----------------------------------------------------------------
STEP="downloading the app"
say "Downloading AoS Coach ($BRANCH)…"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$tmp"
src="$(find "$tmp" -maxdepth 2 -type d -name aos-coach | head -n 1)"
[ -n "$src" ] || die "The download does not contain the aos-coach folder."
mkdir -p "$APP"
# Keep the user's data: storage (lists, games, books), .env, army data, installs.
(cd "$src" && tar -cf - --exclude ./storage --exclude ./.env --exclude ./data --exclude ./.cache --exclude ./node_modules --exclude ./dist .) |
  (cd "$APP" && tar -xf -)

cd "$APP"
STEP="installing packages (npm install)"
say "Installing (takes a minute the first time)…"
npm install --no-audit --no-fund --loglevel=error

if [ ! -f data/aos.json ] || [ -n "${AOS_UPDATE_DATA:-}" ]; then
  STEP="downloading the army data"
  say "Downloading the army data…"
  npm run --silent data
fi

if [ ! -f .env ]; then
  cp .env.example .env
  if [ -r /dev/tty ]; then
    printf '\nPaste your Claude API key for the coach (or press Enter to skip for now): '
    read -r key </dev/tty || key=""
    if [ -n "$key" ]; then
      sed -i.bak "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$key|" .env && rm -f .env.bak
      echo "Saved in $APP/.env"
    else
      echo "Skipped. You can add it later in $APP/.env"
    fi
  fi
fi

STEP="building the web app"
say "Building the web app…"
npm run --silent build >/dev/null

# ---- Launcher --------------------------------------------------------------
launcher="$HOME_DIR/Start AoS Coach.command"
cat >"$launcher" <<EOF
#!/bin/bash
# Double-click to start AoS Coach. Close this window (or press Ctrl+C) to stop it.
export PATH="$HOME_DIR/node/bin:\$PATH"
cd "$APP"
# Already running (e.g. an earlier window is still open)? Just open it.
if curl -s -o /dev/null "http://localhost:$PORT/api/meta"; then
  echo "AoS Coach is already running: http://localhost:$PORT"
  command -v open >/dev/null && open "http://localhost:$PORT"
  exit 0
fi
( for i in \$(seq 1 60); do curl -s -o /dev/null "http://localhost:$PORT/api/meta" && break; sleep 0.5; done
  command -v open >/dev/null && open "http://localhost:$PORT" ) &
ip=\$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print \$1}')
echo ""
echo "AoS Coach is starting:  http://localhost:$PORT"
[ -n "\$ip" ] && echo "On your phone (same Wi-Fi):  http://\$ip:$PORT"
echo "Keep this window open while you use it. Ctrl+C to stop."
echo ""
PORT=$PORT npm start
EOF
chmod +x "$launcher"

STEP="starting the app"
say "Done. Starting AoS Coach…"
if [ -n "${AOS_NO_START:-}" ]; then
  echo "Start it any time by double-clicking: $launcher"
  exit 0
fi
exec "$launcher"
