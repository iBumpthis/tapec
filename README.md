# TapeC

TapeC is a lightweight local media server + web UI for browsing and
playing a personal library with timestamp markers (DJ mixes, long-form
sets, albums with cue points, etc.).

-   **Backend:** Fastify + SQLite\
-   **Frontend:** Vanilla HTML/CSS/JS\
-   **Streaming:** Range-based MP3/MP4 streaming\
-   **Config:** JSON (UNC paths supported on Windows)

------------------------------------------------------------------------

## Status

**v0.1 stable**

This repository represents a working baseline:

-   Media library scanning
-   Stale cleanup on rename/delete
-   Library browsing + search
-   Player page
-   Marker import (v0 format)
-   Stable server lifecycle

------------------------------------------------------------------------

## Features

### Backend

-   Fastify server (awaited main lifecycle)
-   SQLite database with `lastSeenScan` tracking
-   Range-based streaming for MP3 / MP4
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

Example:

    00:00 Intro
    01:42 First Track
    05:13 Second Track

Future versions may support additional formats (e.g., ranges and overlap
repair), but v0 intentionally keeps parsing simple and predictable.

------------------------------------------------------------------------

## Requirements

-   Node.js v22+
-   Windows primary test environment (UNC paths supported)
-   No Docker required

------------------------------------------------------------------------

## Setup

Clone the repository:

    git clone https://github.com/YOURUSERNAME/tapec.git
    cd tapec/app

Install dependencies:

    npm install

------------------------------------------------------------------------

## Configuration

Copy the example config:

    copy config.example.json config.json

Edit `config.json`:

-   Set `libraries[].path` (UNC path or local path)
-   Set `dbPath` (default example: `C:\TapeC\tapec.sqlite`)
-   Set `port` (default: `32410`)

Example structure:

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

------------------------------------------------------------------------

## Run

From the app directory:

    npm start

Open in browser:

    http://localhost:32410

------------------------------------------------------------------------

## Project Layout

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

Metadata location (Windows):
C:\ProgramData\TapeC\metadata

Structure:
<LibraryName>/<relative media path>.meta.json

Example:
C:\ProgramData\TapeC\metadata\Music\Artist\Track.mp4.meta.json

Why
- Allows media libraries to be read-only (e.g., NAS shares)
- Prevents accidental writes to source media folders
- Keeps repository clean
- Centralizes metadata for backup

------------------------------------------------------------------------

## Roadmap (Next Phases)

-   Smarter marker import (range support + overlap repair)
-   Playlist system
-   MP4 audio-only toggle
-   Metadata UX polish
-   Mobile export

------------------------------------------------------------------------

## License

MIT --- see LICENSE.

------------------------------------------------------------------------

## Note

TapeC was initially developed with the assistance of ChatGPT as part of
a proof-of-concept and learning process.

While functional, this project is evolving. Review, test, and apply your
own security and production best practices before deploying in sensitive
or exposed environments.
