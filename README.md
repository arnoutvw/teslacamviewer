# TeslaCamViewer

A self-hosted web app for browsing and watching your Tesla dashcam footage.

Point it at a directory of TeslaCam clips and you get a clean interface with
tabs for **RecentClips**, **SavedClips** and **SentryClips**, a synchronized
six-camera player (front large, the others around it), a timeline scrubber with
a red marker at the event moment, speed controls (0.5×–4×), tap-to-swap camera
tiles, and an OpenStreetMap panel showing where the event happened.

## How it works

- **Scanner (backend):** on startup and every 30 s, the server scans
  `RecentClips/`, `SavedClips/` and `SentryClips/` under the data root. Each
  folder of segments becomes one *event*: metadata from `event.json`
  (timestamp, city, street, reason, GPS), segment lists per camera parsed from
  filenames, and real clip durations read from each MP4's `mvhd` box.
- **API:** `GET /api/events/{category}` (summaries), `GET
  /api/events/{category}/{folder}` (per-camera segments + timeline) and `POST
  /api/refresh`. Media never travels through the API: the backend streams MP4s
  with HTTP `Range` support under `/media/...`, so the browser seeks without
  downloading whole clips.
- **Player (frontend):** React + MUI + Vite. A small pure sync engine
  (`frontend/src/player/syncClock.ts`) anchors playback on the front camera as
  master clock, starts 10 s before the event, chains segments per camera, and
  re-syncs the five client cameras every frame with a 150 ms drift-correction
  threshold. Camera name labels, tap-to-swap into the main slot, double-click
  for fullscreen, red event dot on the scrubber, camera-position markers.

## Requirements (local, from source)

- Node ≥ 20 (frontend) and JDK 17+ with Docker-less Gradle (`gradlew` wrapper
  included) (backend)
- A TeslaCam data tree, e.g.:

```
tesla-files/
  RecentClips/   2026-08-31_09-30-00/*.mp4   (optional event.json, thumb.png)
  SavedClips/    ...
  SentryClips/   ...
```

## Run locally (dev)

```bash
# 1. backend — serves the API and media on :8080
cd backend && ./gradlew bootRun        # data root: ../tesla-files, override with TESLACAM_ROOT=/path

# 2. frontend — dev server on :5173, proxies /api and /media to :8080
cd frontend && npm install && npm run dev
# open http://localhost:5173
```

## Run locally (production build)

```bash
cd frontend && npm install && npm run deploy   # builds + copies dist into backend static
cd backend && ./gradlew bootRun                # http://localhost:8080 serves UI + API
# NOTE: restart bootRun after a redeploy — Gradle snapshots resources at startup
```

## Run with Docker

```bash
docker build -t teslacamviewer .
docker run --rm -p 8080:8080 -v /path/to/tesla-files:/data:ro teslacamviewer
# open http://localhost:8080
```

Prebuilt images are published to GHCR on every push to `main`:

```bash
docker run --rm -p 8080:8080 -v /path/to/tesla-files:/data:ro \
  ghcr.io/arnoutvw/teslacamviewer:latest
```

The container serves everything itself: UI + API + media from one port. Dashcam
files are read-only.

## Encrypted clips

Firmware 2026.20+ can encrypt Dashcam/Sentry clips. To play them:

1. Click **Tesla** in the header and log in with your Tesla account (popup).
2. Tesla redirects to a page that will not load — copy the full URL from the
   browser address bar and paste it back into the dialog.
3. Open an encrypted event (marked with a lock icon). Keys are fetched from
   your Tesla account automatically and cached server-side in
   `.teslacam_keys.json` next to your footage.

Caveats:
- The Tesla token lives in your browser's localStorage; log out clears it.
- Key requests to Tesla may occasionally be blocked (HTTP 403, Akamai). Retry
  later if that happens.
- Decryption happens on the fly; unencrypted clips are unaffected.

## Tests

```bash
cd frontend && npm test -- --run      # vitest + testing-library (85 tests)
cd backend && ./gradlew test          # JUnit 5 scanner/API tests
```

## CI

CI builds and tests the frontend and backend on every push, then publishes a
multi-arch Docker image to GHCR (workflow: `.github/workflows/ci.yml`).