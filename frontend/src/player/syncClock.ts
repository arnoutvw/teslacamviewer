export interface SegmentLike {
  camera: string
  start: string
  url: string
  playable: boolean
  estimatedSeconds: number
}

export interface TimelineInputs {
  start: string
  end: string
}

export interface TimelineBounds {
  startMs: number
  endMs: number
}

export interface SegmentAssignment {
  segment: SegmentLike
  offsetSeconds: number
}

/** Spec: drift > 150 ms triggers a corrective seek. */
export const DRIFT_CORRECTION_SECONDS = 0.15
/** Spec: start playing 10 seconds before the event. */
export const START_LEAD_SECONDS = 10

/**
 * Backend timestamps are ISO-8601 local times without zone. `new Date()` parses
 * them as local time — as long as every comparison goes through this function,
 * values are mutually consistent and no timezone conversion happens.
 */
export function timestampMs(iso: string): number {
  return new Date(iso).getTime()
}

export function timelineBoundsMs(t: TimelineInputs): TimelineBounds {
  return { startMs: timestampMs(t.start), endMs: timestampMs(t.end) }
}

function clamp(ms: number, bounds: { startMs: number; endMs: number }): number {
  return Math.min(Math.max(ms, bounds.startMs), bounds.endMs)
}

/** Red-dot position and playback anchor: event timestamp clamped into the timeline. */
export function eventPointMs(eventTimestamp: string, bounds: { startMs: number; endMs: number }): number {
  return clamp(timestampMs(eventTimestamp), bounds)
}

export function startPositionMs(eventTimestamp: string, bounds: { startMs: number; endMs: number }): number {
  return clamp(eventPointMs(eventTimestamp, bounds) - START_LEAD_SECONDS * 1000, bounds)
}

/** Last segment starting at or before absoluteMs; offset clamped so a position past the final estimated end holds the last frame. */
export function findSegmentAt(list: SegmentLike[], absoluteMs: number): SegmentAssignment | null {
  let current: SegmentLike | null = null
  for (const s of list) {
    if (timestampMs(s.start) <= absoluteMs) current = s
    else break
  }
  if (current == null) return null
  const offset = (absoluteMs - timestampMs(current.start)) / 1000
  return { segment: current, offsetSeconds: Math.max(0, Math.min(offset, current.estimatedSeconds)) }
}

export function videoAbsoluteMs(videoTimeSeconds: number, seg: SegmentLike): number {
  return timestampMs(seg.start) + videoTimeSeconds * 1000
}

export function driftSeconds(videoTimeSeconds: number, seg: SegmentLike, masterAbsoluteMs: number): number {
  return (videoAbsoluteMs(videoTimeSeconds, seg) - masterAbsoluteMs) / 1000
}

export function needsCorrection(drift: number): boolean {
  return Math.abs(drift) > DRIFT_CORRECTION_SECONDS
}