#!/bin/bash
set -e

echo "=== Tomato Watch Party Installer ==="

if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo: sudo bash install.sh"
  exit 1
fi

INSTALL_DIR="${INSTALL_DIR:-/opt/tomato-watch-party}"

if ! command -v rsync &>/dev/null; then
  apt-get update && apt-get install -y rsync
fi

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

# Create install directory and copy only application files (no media,
# dependencies, local env, or logs).
echo "Setting up application in $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
rsync -a \
  --exclude='movies' \
  --exclude='music' \
  --exclude='streams' \
  --exclude='hls' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='*.log' \
  --exclude='*.tar.gz' \
  ./ "$INSTALL_DIR/"
cd "$INSTALL_DIR"

# Install dependencies
echo "Installing Node.js dependencies..."
npm install --production
cd server && npm install --production && cd ..
cd client && npm install && npm run build && cd ..

# Setup directories
mkdir -p "$INSTALL_DIR/movies" "$INSTALL_DIR/music" "$INSTALL_DIR/streams"

# Setup .env if missing, with random secrets
if [ ! -f .env ]; then
  echo "Generating .env with random secrets..."
  HOST_PASSWORD="$(openssl rand -hex 16)"
  JWT_SECRET="$(openssl rand -hex 32)"
  sed -e "s|^HOST_PASSWORD=.*|HOST_PASSWORD=${HOST_PASSWORD}|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" \
      .env.example > .env
  chmod 600 .env
  echo "Created $INSTALL_DIR/.env"
fi

echo ""
echo "=== Installation Complete ==="
echo "Application installed at: $INSTALL_DIR"
echo ""
echo "Next steps:"
echo "  1. Review $INSTALL_DIR/.env (secrets were generated if missing)"
echo "  2. Place movie files in $INSTALL_DIR/movies and DJ tracks in $INSTALL_DIR/music"
echo "  3. Start with: cd $INSTALL_DIR && npm start"
echo ""
echo "To run as a systemd service:"
echo "  sudo bash install.sh --systemd"
echo ""

# Optional systemd service setup
if [ "$1" = "--systemd" ]; then
  echo "Creating systemd service..."
  cat > /etc/systemd/system/tomato-watch-party.service <<SVCEOF
[Unit]
Description=Tomato Watch Party Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
EnvironmentFile=-$INSTALL_DIR/.env
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

  systemctl daemon-reload
  systemctl enable tomato-watch-party
  systemctl start tomato-watch-party
  echo "Systemd service 'tomato-watch-party' created and started."
  echo "Check status with: sudo systemctl status tomato-watch-party"
fi
