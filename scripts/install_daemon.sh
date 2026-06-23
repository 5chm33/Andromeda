#!/bin/bash
# install_daemon.sh - Installs Andromeda RSI as a background service

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER=$(whoami)

echo "=== Andromeda RSI Daemon Installer ==="

if ! command -v pm2 &> /dev/null; then
    echo "PM2 not found. Installing PM2 globally..."
    npm install -g pm2
fi

echo "1. Building project..."
cd "$DIR"
npm run build

echo "2. Starting with PM2..."
mkdir -p logs
pm2 start scripts/ecosystem.config.js

echo "3. Saving PM2 state..."
pm2 save

echo "4. Setting up startup script..."
pm2 startup | grep "sudo" | bash || echo "Please run the sudo command shown above manually to enable start on boot."

echo "=== Installation Complete ==="
echo "To view logs: pm2 logs andromeda-rsi"
echo "To monitor:   pm2 monit"
echo "To stop:      pm2 stop andromeda-rsi"
