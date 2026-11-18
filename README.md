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

# 2. Fetch the tomato-play submodule (web search/streaming)
git submodule update --init --recursive

# 3. Start the server
./twp-start

# 4. Open in browser
open http://localhost:3000
```

If you cloned with `git clone --recursive`, step 2 is already done.

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
- **Web streaming** — Host-only web search and streaming from anime providers via the bundled tomato-play CLI; the audience watches the same synced room
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
- `bash` and `curl` (for the tomato-play web streaming submodule)
- cloudflared (optional, for remote sharing)

## Configuration

Copy `.env.example` to `.env` and set strong values:

```bash
cp .env.example .env
echo "HOST_PASSWORD=$(openssl rand -base64 24)" >> .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
```

The server refuses to start while `HOST_PASSWORD` or `JWT_SECRET` is unset or still a default value. `MOVIE_DIR`, `MUSIC_DIR`, and `STREAM_DIR` default to `./movies`, `./music`, and `./streams`; set them to absolute paths for remote sharing. The DJ room reads its track list from `MUSIC_DIR`.

## Web Streaming (tomato-play)

The host can search and stream from tomato-play's anime providers without leaving the watch party. Open the **🌐 Web** tab in the host controls, search, pick a series and episode, choose sub/dub and quality, then press Play. The stream plays in the movie room and the audience syncs exactly like a local movie — chat, throws, reactions, and the viewer list all keep working.

- Host-only: search and playback controls require the movie-room host password.
- The audience never runs tomato-play. The server resolves the stream and serves it through a same-origin proxy, so viewers just load a normal HLS URL.
- Streams are ephemeral: nothing is added to the local movie library and no watch position is stored.
- Live streams play without a seek bar; VOD seeking works like a local movie.

Setup:

```bash
git submodule update --init --recursive
```

Enable it in `.env`:

```bash
TOMATOPLAY_ENABLED=1
TOMATOPLAY_BIN=server/vendor/tomato-play/tomatoplay
```

`TOMATOPLAY_BIN` is resolved relative to the project root when it is not absolute. The server logs `tomato-play integration ready` at startup, or a warning when the binary is missing (the Web tab is hidden in that case).

The bundled tomato-play is a git submodule pointing at `https://github.com/killahtomato/tomato-play.git`. Clone recursively, or run `git submodule update --init --recursive` after a normal clone.

The submodule is GPLv3 and this project is MIT. That is fine for private/local use, but a distributed combined work must be licensed under GPLv3.

### Server deployment

tomato-play is vendored, so you do not install it separately, but the server needs:

- the submodule present (`git clone --recursive`, or copy `server/vendor/tomato-play`)
- `bash` and `curl` (Debian/Ubuntu: `apt install curl`)
- `TOMATOPLAY_ENABLED=1` in the environment (on by default in `.env.example` and Docker Compose)
- a writable `HOME` for the tomato-play cache (`~/.cache/tomato-play`; override with `TOMATOPLAY_CACHE_DIR`)

Docker: the image installs `ffmpeg` and `curl` and copies the submodule, and `docker-compose.yml` enables the integration by default (`TOMATOPLAY_ENABLED` defaults to `1`).

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

## Mobile Site

A dedicated mobile site is served at `/m` for phones and tablets. Visitors opening the main link on a mobile browser are redirected there automatically; a "Mobile site" link in the corner of the desktop site and a "Switch to desktop site" button on mobile let you change versions manually.

The mobile site is audience-only: watch the movie or DJ set, chat, throw, react, and adjust volume, quality, audio track, and subtitles. Hosting stays on the desktop site.

To develop or build the mobile app:

```bash
npm run dev:mobile     # Vite dev server on http://localhost:5174
npm run build:mobile   # production build into mobile/dist
```

The mobile app is a PWA: on mobile browsers you can add it to your home screen and it opens full-screen.

Mobile viewers pick their audio track with a server-side remux, cached in `streams/_remux`. The server pre-warms the alternate tracks when a movie starts, so switching is usually instant; the cache can be deleted to reclaim disk space.

## Docker

```bash
HOST_PASSWORD=change-me JWT_SECRET=$(openssl rand -hex 32) docker-compose up -d
```

Both `HOST_PASSWORD` and `JWT_SECRET` must be set; the container refuses to start without them.

## Tech Stack

- **Backend** — Node.js + Express + Socket.io
- **Frontend** — React + Vite
- **Transcoding** — FFmpeg with hardware acceleration auto-detection
- **Web streaming** — tomato-play CLI submodule + hls.js, served through a same-origin HLS proxy
- **Sync** — Server-authoritative position with 2-second broadcast + drift correction
