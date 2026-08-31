# TeslaCam Viewer — Design

Date: 2026-08-31
Status: Approved (brainstorming complete)

## Overview

Home-server web app to browse and play Tesla dashcam footage. A Kotlin/Spring Boot 4
backend indexes event folders from a dashcam file tree and serves video via HTTP Range.
A React (MUI) frontend lists events per category, plays all 6 camera views in a
synchronized timeline with an event marker, and shows the event location on OpenStreetMap.

No auth, single user, runs in Docker with the footage mounted as a volume.

## Source data (observed from real footage)

```
<root>/
├── RecentClips/            category folders
├── SavedClips/
└── SentryClips/
    └── 2026-07-10_17-21-39/        event folder = timestamp of event end
        ├── event.json              optional
        ├── thumb.png               128x83 PNG
        ├── 2026-07-10_17-19-23-front.mp4       segment, ~60s, H.264, 2896x1876
        ├── 2026-07-10_17-19-23-back.mp4        same start time per camera
        ├── 2026-07-10_17-20-24-front.mp4       longer events have more segments
        └── ...
```

- Segment start encoded in filename `yyyy-MM-dd_HH-mm-ss-<camera>.mp4`.
- All cameras share the same segment start times (first segment can be partial:
  missing cameras and 0-byte files were observed in real data).
- `event.json` shape (types as strings):

```json
{
  "timestamp": "2026-07-10T17:20:19",
  "city": "Grefrath",
  "street": "Flugplatz",
  "est_lat": "51.3352",
  "est_lon": "6.35791",
  "reason": "sentry_aware_object_detection",
  "camera": "5"
}
```

- Event folder name uses `-` separators; json timestamp uses `T`.

## Backend

Kotlin 2.x, Spring Boot 4, Gradle Kotlin DSL, JDK 25. In-memory index, no database.

### Configuration

| Property | Default | Meaning |
|---|---|---|
| `teslacam.root` | env `TESLACAM_ROOT` | Root of the dashcam tree (contains the 3 category folders) |
| `teslacam.camera-order` | `front,back,left_repeater,right_repeater,left_pillar,right_pillar` | Index mapping for `event.json` `camera` field (0-based) |

`camera: "5"` with the default order = `right_pillar`.

### Scanning

`EventScanner` walks `RecentClips|SavedClips|SentryClips/*` at startup, on
`POST /api/refresh`, and via an automatic rescan every 30 s. Event = folder
containing at least one `.mp4`. For each event:

- Parse `event.json` if present and valid; tolerate missing, corrupt or partial
  JSON (skip fields, never fail the event).
- Parse mp4 filenames into segments `{camera, start, file}`; ignore files that
  do not match the segment pattern, 0-byte files still count as present but are
  flagged unplayable.
- Event index entries are immutable snapshots; a rescan replaces the whole index
  atomically.

### REST API

| Endpoint | Returns |
|---|---|
| `GET /api/events/{category}` | List of events: folder, timestamp, city, street, reason, camera, camera name, segment count, playability info |
| `GET /api/events/{category}/{folder}` | Detail: per-camera list of segments `{start, duration(estimated from file size), url}`, overall timeline start/end, event json fields |
| `GET /media/{category}/{folder}/{file}` | Video stream with HTTP 206 Range support (`ResourceRegion`), correct Content-Type |
| `GET /media/{category}/{folder}/thumb.png` | PNG bytes |
| `POST /api/refresh` | Trigger rescan, returns new index stats |

- `category` restricted to the three known folders; `folder`/`file` sanitized:
  canonical-path check under the category directory, whitelist filename pattern.
- Segment durations estimated from file size (bitrate from largest known segment)
  to avoid probing every file on scan; exact duration is not required because the
  frontend follows segment chaining and the master clock.
- Unknown category → 404. Missing file → 404.

### Tests

- JUnit 5 + Spring `@WebMvcTest`/`@SpringBootTest` with a fixture tree under
  `src/test/resources` replicating real quirks: missing json, 0-byte segments,
  missing cameras, nested long event, traversal attempt payloads.
- Range request tests: full file, mid-file range, tail range, invalid range.

## Frontend

React 18+, Vite, TypeScript, MUI v6 (Material Design). Leaflet + OSM tiles for map.
Dev: Vite proxy to backend; Prod: Vite build consumed by Spring static resources.

### Views

1. **Event list** — MUI `Tabs` for Recent / Saved / Sentry. Each row: `thumb.png`,
   event timestamp, street + city, reason label (humanized), event-camera badge.
   Polls `/api/events/{category}` every 30 s. Click a row → player view.
2. **Player** — the core view (below).

### Player

- **Camera grid**: front large and center, the other 5 arranged around it
  (CSS grid, fixed sensible layout; drag-rearrange explicitly out of scope).
- **Sync engine** (isolated plain-TS module `syncClock.ts`, unit-testable):
  - Front camera is the master clock.
  - Timeline position `t` maps to `(segment, offsetInSegment)` per camera from
    segment start times; each `<video>` element plays only its current segment
    and advances to the next on end (small pre-buffer).
  - rAF loop measures drift of slave videos against the master; drift > 150 ms
    triggers a corrective seek (muted videos only, so no audio constraints).
  - Start position default: event timestamp − 10 s (clamped to timeline start).
  - Scrubbing: seek all cameras; segments render placeholder until seeked.
- **Controls**: play/pause, ±10 s, speed 0.5/1/2/4, timeline scrubber spanning
  the whole event, **red dot marker** at the event timestamp on the scrubber.
- **Event camera highlight**: the tile for the json `camera` gets a red ring;
  tapping a tile zooms it to fullscreen (tap again to restore).
- **Map**: Leaflet, marker at `est_lat`/`est_lon`, caption street/city; hidden
  entirely when event has no json location.

### MUI/Material details

- Dark-friendly theme (dashcam footage viewer in living room), sensible MUI theme
  with a custom primary color; all icons material.

## Error handling & edge cases matrix

| Case | Behavior |
|---|---|
| No `event.json` | Event listed, no map, no red-dot timestamp (marker defaults to folder end) |
| Corrupt/missing camera segment | Gray tile "no footage" instead of video element |
| 0-byte segment | Treated as unplayable, same gray tile |
| Corrupt `thumb.png` | Placeholder icon in list |
| Path traversal / weird URL | 404 via canonical-path guard |
| Root folder missing at startup | App boots, API returns empty lists, refresh retries |
| Scan in progress | Old index served until scan atomically replaces it |

## Deployment

- Multi-stage Dockerfile: node builds frontend → gradle builds backend boot jar
  with `static/` → runtime image with JRE 25.
- Volume mount for footage root; `TESLACAM_ROOT` env var.

## Out of scope (YAGNI)

- Transcoding/HLS, user accounts, drag-rearrange of tiles, GPS track overlay from
  footage metadata, delete/edit of events, mobile-specific layout.