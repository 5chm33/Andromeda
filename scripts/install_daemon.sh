#!/usr/bin/env bash
# install_daemon.sh — Installs Andromeda as a system daemon
# Supports: Linux (systemd), macOS (launchd)
# Usage: bash scripts/install_daemon.sh [install|uninstall|start|stop|status|logs]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROMEDA_DIR="$(dirname "$SCRIPT_DIR")"
HOME_DIR="$HOME"
OS="$(uname -s)"
ACTION="${1:-install}"

# ─── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[andromeda]${NC} $*"; }
warn()  { echo -e "${YELLOW}[andromeda]${NC} $*"; }
error() { echo -e "${RED}[andromeda]${NC} $*" >&2; exit 1; }

# ─── Preflight ─────────────────────────────────────────────────────────────────
if [ ! -f "$ANDROMEDA_DIR/dist/server/andromedaDaemon.js" ]; then
  error "Build not found. Run 'pnpm build' first."
fi

# ─── Linux (systemd) ───────────────────────────────────────────────────────────
install_linux() {
  info "Installing systemd user service..."
  SYSTEMD_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SYSTEMD_DIR"

  # Substitute paths in service file
  sed \
    -e "s|%h|$HOME_DIR|g" \
    -e "s|%i|$(whoami)|g" \
    "$SCRIPT_DIR/andromeda.service" \
    | sed "s|%h/andromeda|$ANDROMEDA_DIR|g" \
    > "$SYSTEMD_DIR/andromeda.service"

  systemctl --user daemon-reload
  systemctl --user enable andromeda.service
  info "Installed. Run: systemctl --user start andromeda"
}

uninstall_linux() {
  info "Removing systemd user service..."
  systemctl --user stop andromeda.service 2>/dev/null || true
  systemctl --user disable andromeda.service 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/andromeda.service"
  systemctl --user daemon-reload
  info "Uninstalled."
}

start_linux()  { systemctl --user start andromeda.service && info "Started."; }
stop_linux()   { systemctl --user stop andromeda.service && info "Stopped."; }
status_linux() { systemctl --user status andromeda.service; }
logs_linux()   { journalctl --user -u andromeda.service -f; }

# ─── macOS (launchd) ──────────────────────────────────────────────────────────
PLIST_SRC="$SCRIPT_DIR/com.andromeda.agent.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.andromeda.agent.plist"

install_macos() {
  info "Installing launchd agent..."
  mkdir -p "$HOME/Library/LaunchAgents"
  mkdir -p "$HOME/.andromeda"

  # Substitute placeholder paths
  sed \
    -e "s|ANDROMEDA_DIR|$ANDROMEDA_DIR|g" \
    -e "s|HOME_DIR|$HOME_DIR|g" \
    "$PLIST_SRC" > "$PLIST_DST"

  launchctl load -w "$PLIST_DST"
  info "Installed and started. Logs: $HOME/.andromeda/daemon.log"
}

uninstall_macos() {
  info "Removing launchd agent..."
  launchctl unload -w "$PLIST_DST" 2>/dev/null || true
  rm -f "$PLIST_DST"
  info "Uninstalled."
}

start_macos()  { launchctl load -w "$PLIST_DST" && info "Started."; }
stop_macos()   { launchctl unload "$PLIST_DST" && info "Stopped."; }
status_macos() { launchctl list | grep andromeda || info "Not running."; }
logs_macos()   { tail -f "$HOME/.andromeda/daemon.log"; }

# ─── Dispatch ─────────────────────────────────────────────────────────────────
case "$OS" in
  Linux)
    case "$ACTION" in
      install)   install_linux ;;
      uninstall) uninstall_linux ;;
      start)     start_linux ;;
      stop)      stop_linux ;;
      status)    status_linux ;;
      logs)      logs_linux ;;
      *) error "Unknown action: $ACTION. Use install|uninstall|start|stop|status|logs" ;;
    esac
    ;;
  Darwin)
    case "$ACTION" in
      install)   install_macos ;;
      uninstall) uninstall_macos ;;
      start)     start_macos ;;
      stop)      stop_macos ;;
      status)    status_macos ;;
      logs)      logs_macos ;;
      *) error "Unknown action: $ACTION. Use install|uninstall|start|stop|status|logs" ;;
    esac
    ;;
  *)
    error "Unsupported OS: $OS. Only Linux (systemd) and macOS (launchd) are supported."
    ;;
esac
