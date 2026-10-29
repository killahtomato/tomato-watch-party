#!/bin/bash
set -e

echo "=== Movie Stream Installer ==="

# Check for root/sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo: sudo bash install.sh"
  exit 1
fi

INSTALL_DIR="${INSTALL_DIR:-/opt/movie-stream}"

# Install Node.js 20 if not present
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Install FFmpeg if not present
if ! command -v ffmpeg &>/dev/null; then
  echo "Installing FFmpeg..."
  apt-get update && apt-get install -y ffmpeg
fi

# Create install directory
echo "Setting up application in $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"
cd "$INSTALL_DIR"

# Install dependencies
echo "Installing Node.js dependencies..."
npm install --production
cd server && npm install --production && cd ..
cd client && npm install && npm run build && cd ..

# Setup directories
mkdir -p "$INSTALL_DIR/server/movies"
mkdir -p "$INSTALL_DIR/server/hls"

# Setup .env if missing
if [ ! -f .env ]; then
  echo "Creating .env from template..."
  cp .env.example .env
  echo "IMPORTANT: Edit $INSTALL_DIR/.env to set your HOST_PASSWORD and MOVIE_DIR"
fi

echo ""
echo "=== Installation Complete ==="
echo "Application installed at: $INSTALL_DIR"
echo ""
echo "Next steps:"
echo "  1. Edit $INSTALL_DIR/.env with your settings"
echo "  2. Place movie files in your MOVIE_DIR"
echo "  3. Start with: cd $INSTALL_DIR && npm start"
echo ""
echo "To run as a systemd service:"
echo "  sudo bash install.sh --systemd"
echo ""

# Optional systemd service setup
if [ "$1" = "--systemd" ]; then
  echo "Creating systemd service..."
  cat > /etc/systemd/system/movie-stream.service <<SVCEOF
[Unit]
Description=Movie Stream Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

  systemctl daemon-reload
  systemctl enable movie-stream
  systemctl start movie-stream
  echo "Systemd service 'movie-stream' created and started."
  echo "Check status with: sudo systemctl status movie-stream"
fi
