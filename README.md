# Tomato Watch Party

Synchronized movie streaming platform with audience chat, throwing, and reactions.

Watch movies together with friends. The host controls playback, the audience throws tomatoes/popcorn, and everyone can react in real-time.

## Quick Start

```bash
# Install dependencies
npm run install:all

# Start server + client (dev mode)
npm run dev

# Or production build
npm run build && npm start
```

## Features
- MP4 transcoding with hardware acceleration auto-detection
- Host-controlled synchronized playback
- Throw tomatoes and popcorn at the screen
- Real-time reactions with floating animation
- Audience chat with join/leave notifications
- Viewer list with slide-out panel
- Fullscreen with double-click
- Persistent cache across restarts

## Requirements
- Node.js 18+
- FFmpeg (with hardware encoder optional)

## Configuration
Copy `.env.example` to `.env` and customize:
- `HOST_PASSWORD` — Host authentication password
- `MOVIE_DIR` — Path to your movie files
- `PORT` — Server port (default: 3000)

## Docker
```bash
docker-compose up -d
```

## Remote Access
Use cloudflare for remote friends:
```bash
./twp-party
```
