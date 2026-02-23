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

Libraries were updated to an array starting in v0.2.1 to allow multiple
libraries/directories to be loaded

Example Structure:

``` json
    "libraries": [
    { "name": "Music", "path": "\\\\SERVERorHOST\\directoryA\\mixtapes" },
    { "name": "Concerts", "path": "\\\\SERVERorHOST\\directoryB\\concerts" }
  ],
```

------------------------------------------------------------------------

## Run

From the app directory:

    npm start

Open in browser:

    http://localhost:32410

(Optional):

    Run as service and start on boot for local media servers
    Locally using NSSM
    Current state requires a service stop/start for any js file changes, recommend a .bat if tinkering

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

TapeC was initially developed with the assistance of ChatGPT as part of
a proof-of-concept and learning process.

While functional, this project is evolving. Review, test, and apply your
own security and production best practices before deploying in sensitive
or exposed environments.
