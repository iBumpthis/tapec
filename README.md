# TapeC

TapeC is a lightweight local media server + web UI for browsing and
playing a personal library with timestamp markers (DJ mixes, long-form
sets, albums with cue points, etc.).

-   **Backend:** Fastify + SQLite
-   **Frontend:** Vanilla HTML/CSS/JS
-   **Streaming:** Range-based MP3/MP4 streaming
-   **Config:** JSON (UNC paths supported on Windows)

------------------------------------------------------------------------

## Status

**v0.2.2 stable**

This repository represents a working baseline:

-   Media library scanning
-   Stale cleanup on rename/delete
-   Library browsing + search
-   Player page
-   Track Marker Import (v0.2 format)
-   Stable server lifecycle

------------------------------------------------------------------------

## Features

### Backend

-   Fastify server (awaited main lifecycle)
-   SQLite database with `lastSeenScan` tracking
-   Range-based streaming for MP3 / MP4 / m4a / WAV
-   Stale media cleanup after scan
-   API endpoints:
    -   `GET /api/library`
    -   `GET /api/media/:id`
    -   `GET /api/media/:id/meta`
    -   `POST /api/scan`
    -   `GET /api/health`

### Frontend

-   Library listing with search/filter
-   Player page
-   Marker import (format below)
-   Scan button triggers `/api/scan`

------------------------------------------------------------------------

## Marker Import (v0 Format)

Current importer accepts:

    MM:SS Track Name
    Track Name HH:MM:SS
    Track Name [MM:SS-MM:SS]
    ...
    And similar variations on a per line basis in the Import Markers block

Example:

    00:00 Intro
    01:42 First Track
    05:13 Second Track

    OR

    Track One [00:00-00:45]
    Track Two [00:45-03:22]

Future versions may support additional formats (e.g., ranges and overlap
repair), but v0 intentionally keeps parsing simple and predictable.

------------------------------------------------------------------------

## Requirements

-   Node.js v22+ (direct deployment)
-   Docker + Docker Compose (containerized deployment)
-   Windows or Linux (both supported; see deployment options below)

------------------------------------------------------------------------

## Setup

Clone the repository:

    git clone https://github.com/iBumpthis/tapec.git
    cd tapec

------------------------------------------------------------------------

## Configuration

Copy the example config:

**Linux / macOS:**

    cp app/config.example.json app/config.json

**Windows:**

    copy app\config.example.json app\config.json

Edit `config.json`:

-   Set `libraries[].path` to your media directories
-   Set `dbPath` to your preferred SQLite location
-   Set `port` (default: `32410`)

### Example — Windows (UNC paths)

``` json
{
  "libraries": [
    { "name": "Music", "path": "\\\\SERVER\\SHARE\\Music" }
  ],
  "dbPath": "C:\\TapeC\\tapec.sqlite",
  "port": 32410,
  "allowedExtensions": ["mp3", "mp4", "m4a", "wav"]
}
```

### Example — Linux (local or mounted paths)

``` json
{
  "libraries": [
    { "name": "Music", "path": "/mnt/media/music" }
  ],
  "dbPath": "/var/lib/tapec/tapec.sqlite",
  "port": 32410,
  "allowedExtensions": ["mp3", "mp4", "m4a", "wav"]
}
```

Libraries are defined as an array (since v0.2.1) to support multiple
directories:

``` json
"libraries": [
  { "name": "Music",    "path": "/mnt/media/mixtapes" },
  { "name": "Concerts", "path": "/mnt/media/concerts" }
]
```

------------------------------------------------------------------------

## Deployment

TapeC supports two deployment paths. Docker is recommended for Linux
home server setups. Direct Node is straightforward on any platform.

### Option A — Docker (recommended for Linux)

Ensure Docker and Docker Compose are installed, then from the repo root:

    docker compose up -d --build

This builds the image and starts TapeC in a detached container.

Open in browser:

    http://<host-ip>:32410

**Updating after a code change:**

    git pull origin main
    docker compose down && docker compose up -d --build

The `--build` flag ensures the image is rebuilt from updated source.
Docker layer caching keeps this fast when dependencies haven't changed.

**Viewing logs:**

    docker compose logs -f

---

### Option B — Direct Node

From the `app` directory:

    npm install
    npm start

Open in browser:

    http://localhost:32410

**Running as a service (Windows — NSSM):**

    Install NSSM, point it at node.exe with server.js as the argument.
    A service stop/start is required for any JS file changes.
    A .bat wrapper is recommended if iterating frequently.

**Running as a service (Linux — systemd):**

Create `/etc/systemd/system/tapec.service`:

``` ini
[Unit]
Description=TapeC Media Server
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/tapec/app/server.js
WorkingDirectory=/path/to/tapec/app
Restart=on-failure
User=youruser

[Install]
WantedBy=multi-user.target
```

Then:

    sudo systemctl enable tapec
    sudo systemctl start tapec

------------------------------------------------------------------------

## Project Layout

    /
      docker-compose.yml
      Dockerfile
      /app
        server.js
        scan.js
        db.js
        config.example.json
        package.json
        public/

------------------------------------------------------------------------

## Metadata Storage (v0.2.1+)

TapeC stores all metadata locally and never writes to media source directories.

**Windows:**

    Metadata location: C:\ProgramData\TapeC\metadata
    Structure: <LibraryName>\<relative media path>.meta.json
    Example:   C:\ProgramData\TapeC\metadata\Music\Artist\Track.mp4.meta.json

**Linux (Docker or direct):**

    Metadata location: /var/lib/tapec/metadata
    Structure: <LibraryName>/<relative media path>.meta.json
    Example:   /var/lib/tapec/metadata/Music/Artist/Track.mp4.meta.json

Why separate metadata storage:
-   Allows media libraries to be read-only (e.g., NAS shares)
-   Prevents accidental writes to source media folders
-   Keeps repository clean
-   Centralizes metadata for backup

------------------------------------------------------------------------

## Roadmap (Next Phases)

-   Smarter marker import (range support + overlap repair)
-   Playlist System (for single file/mp3 playback)
    -   Long future phase for playlist creation off markers from longer videos
    -   Long future phase for party input/queue system
-   MP4 audio-only toggle
    -   Playback of video files in audio only mode
    -   Likely to start with simplified audio only player
    -   Future ffmpeg transcode to audio format
-   Metadata UX polish
-   Mobile Export
    -   Save and play locally on mobile device or save Audio/Video to mobile device
-   Visualizer for non video playback
    -   Toggle to display vizualizer on video files
-   True dark mode / light mode toggle

------------------------------------------------------------------------

## Last Significant Change

v0.2.2
-   Basic CSS/HTML Updates to improve format/reduce brightness
-   Display Only

------------------------------------------------------------------------

## License

MIT --- see LICENSE.

------------------------------------------------------------------------

## Note

TapeC was initially developed with the assistance of AI tools as part of
a proof of concept and learning process.

While functional, this project is evolving. Review, test, and apply your
own security and production best practices before deploying in sensitive
or exposed environments.
