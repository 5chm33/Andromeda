#!/bin/bash
# Andromeda v9.10.0 — Cloud VM Deployment Script
# Run this once on the cloud VM to set up 24/7 autonomous operation.
# Prerequisites: Node 22, pnpm, git already installed (done by Manus setup)

set -e

REPO_URL="https://github.com/5chm33/Andromeda.git"
INSTALL_DIR="/home/ubuntu/andromeda"
SERVICE_NAME="andromeda"
LOG_FILE="/var/log/andromeda.log"

echo "=== Andromeda Cloud VM Deployment ==="
echo "Install dir: $INSTALL_DIR"

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22 || nvm install 22 && nvm use 22

# Pull latest code
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Updating existing repo..."
    cd "$INSTALL_DIR"
    git pull origin main
else
    echo "Cloning repo..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install deps and build
echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Building..."
pnpm run build

echo "Build complete."

# Create systemd service
NODE_BIN=$(which node)
PNPM_BIN=$(which pnpm)

sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << SYSTEMD
[Unit]
Description=Andromeda AI — Autonomous Self-Improving Agent
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} dist/index.js
Restart=always
RestartSec=10
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=${INSTALL_DIR}/.env.local

[Install]
WantedBy=multi-user.target
SYSTEMD

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}
sudo systemctl restart ${SERVICE_NAME}

echo ""
echo "=== Deployment complete! ==="
echo "Service status: $(sudo systemctl is-active ${SERVICE_NAME})"
echo "Logs: sudo journalctl -u ${SERVICE_NAME} -f"
echo "Or:   tail -f ${LOG_FILE}"
echo ""
echo "To check RSI health: curl http://localhost:3000/api/rsi/health"
echo "To open firewall for external access: sudo ufw allow 3000/tcp"
echo ""
echo "Andromeda is now running 24/7 and will self-improve every 30 minutes."
