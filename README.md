<div align="center">
  <h1>AlphaMe</h1>
  <p>Download and compress audio from YouTube Music, Spotify playlists, and direct links.</p>
  <p>
    <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="Node.js ≥20" />
    <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" />
    <img src="https://img.shields.io/badge/deploy-Railway-blueviolet?style=flat-square" alt="Railway" />
  </p>
</div>

---

## What it does

- **Search YouTube Music** for studio tracks — no video intros, visualizers, or skits
- **Import Spotify playlists** (public) — resolves each track to an official YouTube Music release
- **Import YouTube playlists and links** via yt-dlp
- **Upload local audio files** (MP3, FLAC, ALAC, WAV PCM, AIFF, M4A, OGG, Opus…) and re-encode them
- **Wide format support**: MP3, AAC/M4A, Opus, OGG Vorbis, FLAC (lossless level 12), ALAC (Apple Lossless), WAV PCM, and AIFF PCM
- **Compression profiles**: Auto, Best (320k VBR), Balanced (192k), Compact (128k), Custom (with lossless options)
- **Configurable minimum bitrate floor** (64, 96, 128, 160 kbps) — prevents low-bitrate streams (like 48 kbps AAC) from needlessly inflating into oversized files
- **Recompress** any finished job with different settings
- **Tag editor** — edit title, artist, album, year, genre without re-encoding
- **Download individually** or as a **ZIP**
- **Temporary public links** — optional streaming URL that expires with the job
- **Queue with concurrency** — cancel, retry, batch progress

Everything is ephemeral. Files are deleted after `TTL_MINUTES` (default: 60) and on restart.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express |
| Audio | FFmpeg / FFprobe |
| YouTube | yt-dlp |
| Spotify | spotifyscraper (Python) |
| Frontend | Tailwind CSS v4, vanilla ES modules |

---

## Running locally

**Requirements:** Node 20+, `ffmpeg`, `ffprobe`, `yt-dlp`, Python 3 + `spotifyscraper`

```bash
# install
npm install
pip3 install spotifyscraper

# build frontend (Tailwind CSS + static files)
npm run build

# start
npm start
# → http://localhost:3000
```

Other scripts:

```bash
npm run dev       # watch mode (restarts on src changes)
npm test          # end-to-end tests (requires ffmpeg)
npm run format    # Prettier
```

---

## Deploying on Railway

1. Push to GitHub → [railway.app](https://railway.app) → New Project → Deploy from repo
2. Railway detects `Dockerfile` automatically — FFmpeg, yt-dlp, and Python are installed inside the image
3. Set any variables from `.env.example` as needed (see below)
4. Health check endpoint: `GET /health`

No persistent volume needed — storage is ephemeral by design.

---

## Environment variables

Copy `.env.example` to `.env` and edit. All variables are optional.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `PUBLIC_URL` | *(request host)* | Base URL for download/streaming links |
| `TTL_MINUTES` | `60` | Minutes before jobs and files are deleted |
| `MAX_FILE_MB` | `200` | Per-file size limit |
| `CONCURRENCY` | `2` | Parallel encoding jobs |
| `MAX_PLAYLIST_ITEMS` | `0` (unlimited) | Cap on playlist track imports |
| `WORK_DIR` | `/tmp/alphame` | Scratch directory (wiped on start) |
| `CORS_ORIGIN` | — | Required only if frontend is on a different origin |
| `ALLOW_PRIVATE_URLS` | `false` | Allow fetching private/internal URLs (dev only) |
| `YTDLP_COOKIES_PATH` | — | Path to a Netscape `cookies.txt` file |
| `YTDLP_COOKIES` | — | Netscape cookie content (inline) |
| `YTDLP_COOKIES_BASE64` | — | Base64-encoded `cookies.txt` (easiest for Railway) |
| `PYTHON_PATH` | `python3` | Python interpreter path |
| `SPOTIFY_DELAY_MS` | `200` | Delay between Spotify API calls |

### YouTube cookies

Railway and other datacenter IPs often get bot-verification from YouTube. To bypass it, export your browser cookies and provide them via one of the `YTDLP_COOKIES*` variables.

**Generate `YTDLP_COOKIES_BASE64` from a cookies file:**
```bash
# linux / mac
base64 -w0 cookies.txt

# powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('cookies.txt'))
```

---

## API

All endpoints require an `x-client-id` header (a UUID stored in the browser).

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Server status, ffmpeg/yt-dlp availability |
| `GET` | `/api/info` | Config info (TTL, file size limit) |
| `GET` | `/api/search?q=` | Search YouTube Music |
| `POST` | `/api/upload` | Upload audio files (multipart) |
| `POST` | `/api/import` | Import links or queue a track |
| `POST` | `/api/playlist` | Read a Spotify/YouTube playlist |
| `GET` | `/api/jobs` | List jobs for the current client |
| `POST` | `/api/jobs/:id/cancel` | Cancel a running job |
| `POST` | `/api/jobs/:id/retry` | Retry a failed job |
| `POST` | `/api/jobs/:id/recompress` | Re-encode with new settings |
| `POST` | `/api/jobs/:id/host` | Toggle public streaming link |
| `GET` | `/api/jobs/:id/link` | Get the streaming URL |
| `GET` | `/api/jobs/:id/download` | Download the output file |
| `GET` | `/api/jobs/:id/audio` | Stream audio (for in-page player) |
| `POST` | `/api/jobs/:id/tags` | Update ID3 tags |
| `DELETE` | `/api/jobs/:id` | Remove a job |
| `GET` | `/api/zip` | Download all done jobs as ZIP |
| `POST` | `/api/clear` | Delete all settled jobs |

---

## Project structure

```
src/
  config.js          environment variables and constants
  utils.js           ids, filenames, file helpers
  net.js             SSRF-safe fetch with redirect handling
  media.js           ffprobe analysis, encoding profiles, FFmpeg wrapper
  sources.js         direct URL download and yt-dlp download/list
  jobs.js            job queue, lifecycle, persistence, TTL cleanup
  tags.js            ID3 tag reading, sanitization, rewriting
  playlist_adapter.js  normalizes Spotify and YouTube playlist data
  spotify_reader.js  Python subprocess wrapper for spotifyscraper
  spotify_reader.py  reads Spotify playlists via spotifyscraper
  youtube_reader.js  YouTube playlist reader via yt-dlp
  ytmusic_resolver.js  YouTube Music search and Spotify→YTM resolver
  server.js          Express HTTP server and routes

web/
  index.html         app shell
  styles.css         Tailwind source
  config.js          runtime config (API base URL)
  js/                ES module frontend

scripts/
  build.js           copies web/ → public/, runs Tailwind
  check.js           syntax check all JS files
  ensure-build.js    auto-builds public/ if missing on start
  test.js            end-to-end tests
  test_spotify.js    Spotify integration tests

public/              built frontend (git-ignored)
```

---

## Notes

- **Spotify support** is metadata-only — Spotify audio is protected by DRM and cannot be downloaded directly. Instead, track metadata (title and artist) is scraped and matched against official YouTube Music studio releases (ATV tracks).
- **Bitrates & AAC vs MP3**: Streaming sources frequently deliver audio in AAC (e.g. 48–128 kbps) or Opus. AAC at 48 kbps is perceptually equivalent to ~64–80 kbps MP3 due to higher codec efficiency. Re-encoding 48 kbps AAC to a forced 128 kbps MP3 roughly triples bitrate and inflates file size (~1.5 MB → ~4 MB) without audio quality gains. AlphaMe includes a configurable minimum bitrate floor (64, 96, 128, 160 kbps in Preferences) so you can keep files compact or adhere to standard floors.
- **YouTube** downloading depends on yt-dlp and may require cookies on hosted environments.
- **Temporary links** are served from the app process's own disk — no third-party storage. They expire with the job TTL or on redeploy.
- Make sure you have the right to download and re-encode any content you process.

---

## License

MIT — see [LICENSE](LICENSE)

Made by [paragon506](https://github.com/paragon506)
