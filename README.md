# 🍅 Tomato Watch Party

Synchronized movie and music streaming platform with dual rooms, audience chat, and throw mechanics.

Watch movies together with friends or host a DJ party. The host controls playback, the audience throws tomatoes and popcorn, reacts in real-time, and stays in perfect sync.

## Rooms

- **🎬 Movie Room** — Video streaming with host controls, audio track switching, subtitle selection, quality selection, chat, throws, and reactions
- **🎵 DJ Room** — Audio-only streaming with radial visualizer, track playlist, autoplay, chat, and reactions (🍾 💸 ❄️ 🤘)

Switch between rooms instantly. Both rooms keep playing independently.

## Quick Start

```bash
# 1. Copy environment file and set strong secrets
cp .env.example .env
echo "HOST_PASSWORD=$(openssl rand -base64 24)" >> .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

# 2. Start the server
./twp-start

# 3. Open in browser
open http://localhost:3000
```

## Helper Scripts

| Command | Description |
|---------|-------------|
| `./twp-start` | Start server on http://localhost:3000 (detached) |
| `./twp-kill` | Stop server, ffmpeg, tunnels, and cloudflared |
| `./twp-party` | Start server + Cloudflare Tunnel for remote friends |
| `./twp-party --background` | Same as above, but daemonizes and exits |
| `./twp-transcode` | Batch transcode all movies (pacman progress bar) |

## Features

- **Synchronized playback** — Host controls play, pause, seek; audience syncs automatically
- **Audio track switching** — Per-user audio track selection (dual audio support)
- **Subtitle selection** — Per-user subtitle track selection with WebVTT overlay
- **Quality selection** — 1080p, 720p, 480p with auto-switch on poor connection
- **Chat** — Separate chat per room with system messages
- **Throws** — Tomatoes and popcorn with splatter animation (Movie Room)
- **Reactions** — Emoji reactions with floating animation (🍾 💸 ❄️ 🤘 in DJ Room)
- **Viewer list** — Slide-out panel with signal strength, ping, and quality controls
- **Fullscreen** — Double-click video
- **Persistent cache** — Transcoded files cached across restarts

## Requirements

- Node.js 18+
- FFmpeg (with hardware encoder optional)
- cloudflared (optional, for remote sharing)

## Configuration

Copy `.env.example` to `.env` and set strong values:

```bash
cp .env.example .env
echo "HOST_PASSWORD=$(openssl rand -base64 24)" >> .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
```

The server refuses to start while `HOST_PASSWORD` or `JWT_SECRET` is unset or still a default value. `MOVIE_DIR`, `MUSIC_DIR`, and `STREAM_DIR` default to `./movies`, `./music`, and `./streams`; set them to absolute paths for remote sharing. The DJ room reads its track list from `MUSIC_DIR`.

## Transcoding

```bash
# Batch transcode all movies with progress bar
./twp-transcode

# Or transcode on-demand (automatic when selecting a movie)
```

The transcode tool:
- Shows pacman-style progress bar with ETA
- Skips already-transcoded files (cache check)
- Transcodes all qualities: 1080p, 720p, 480p
- Preserves all audio tracks and converts text subtitles to mov_text
- Derives lower qualities from the master automatically

## Remote Sharing

Use Cloudflare Tunnel to share your party with friends:

```bash
./twp-party              # Foreground
./twp-party --background # Background/daemonized
```

The script installs dependencies if missing, starts the server, launches cloudflared, and prints a shareable `trycloudflare.com` URL.

The tunnel URL is public. Use a strong `HOST_PASSWORD`, keep `JWT_SECRET` secret, and avoid posting the URL publicly. For anything beyond a private party, put the tunnel behind Cloudflare Access or another access-control layer.

## Docker

```bash
HOST_PASSWORD=change-me JWT_SECRET=$(openssl rand -hex 32) docker-compose up -d
```

Both `HOST_PASSWORD` and `JWT_SECRET` must be set; the container refuses to start without them.

## Tech Stack

- **Backend** — Node.js + Express + Socket.io
- **Frontend** — React + Vite
- **Transcoding** — FFmpeg with hardware acceleration auto-detection
- **Sync** — Server-authoritative position with 2-second broadcast + drift correction
