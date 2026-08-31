import { describe, expect, it } from 'vitest'
import {
  DRIFT_CORRECTION_SECONDS,
  driftSeconds,
  eventPointMs,
  findSegmentAt,
  needsCorrection,
  startPositionMs,
  timestampMs,
  timelineBoundsMs,
  videoAbsoluteMs,
  type SegmentLike,
} from './syncClock'

const seg = (camera: string, start: string, estimatedSeconds: number, url?: string, playable = true): SegmentLike => ({
  camera,
  start,
  url: url ?? `/media/x/${start}-${camera}.mp4`,
  playable,
  estimatedSeconds,
})

const FRONT = [seg('front', '2026-07-10T17:19:23', 60), seg('front', '2026-07-10T17:20:24', 17)]
const FRONT_START = timestampMs('2026-07-10T17:19:23')

describe('timestampMs / timelineBoundsMs', () => {
  it('parses ISO local-time strings', () => {
    expect(timestampMs('2026-07-10T17:19:23')).toBe(new Date('2026-07-10T17:19:23').getTime())
  })
  it('orders start < end', () => {
    const b = timelineBoundsMs({ start: '2026-07-10T17:19:23', end: '2026-07-10T17:20:41' })
    expect(b.startMs < b.endMs).toBe(true)
  })
})

describe('eventPointMs', () => {
  const b = timelineBoundsMs({ start: '2026-07-10T17:19:23', end: '2026-07-10T17:20:41' })
  it('returns the event timestamp when inside the timeline', () => {
    expect(eventPointMs('2026-07-10T17:20:19', b)).toBe(timestampMs('2026-07-10T17:20:19'))
  })
  it('clamps before the timeline to the start', () => {
    expect(eventPointMs('2026-07-10T17:00:00', b)).toBe(b.startMs)
  })
  it('clamps after the timeline to the end', () => {
    expect(eventPointMs('2026-07-11T08:00:00', b)).toBe(b.endMs)
  })
})

describe('startPositionMs', () => {
  const b = { startMs: FRONT_START, endMs: FRONT_START + 77_000 }
  it('is 10s before the event', () => {
    expect(startPositionMs('2026-07-10T17:20:00', b)).toBe(timestampMs('2026-07-10T17:19:50'))
  })
  it('clamps to the timeline start when the lead would fall before it', () => {
    expect(startPositionMs('2026-07-10T17:19:23', b)).toBe(b.startMs)
  })
})

describe('findSegmentAt', () => {
  it('returns null before the first segment', () => {
    expect(findSegmentAt(FRONT, FRONT_START - 1)).toBeNull()
  })
  it('assigns the first segment with offset', () => {
    const a = findSegmentAt(FRONT, FRONT_START + 5_000)
    expect(a?.segment.start).toBe('2026-07-10T17:19:23')
    expect(a?.offsetSeconds).toBeCloseTo(5.0)
  })
  it('assigns the second segment after its start', () => {
    const a = findSegmentAt(FRONT, FRONT_START + 62_000)
    expect(a?.segment.start).toBe('2026-07-10T17:20:24')
    expect(a?.offsetSeconds).toBeCloseTo(1.0)
  })
  it('clamps past the last segment end instead of rolling to null', () => {
    const a = findSegmentAt(FRONT, FRONT_START + 600_000)
    expect(a?.segment.start).toBe('2026-07-10T17:20:24')
    expect(a?.offsetSeconds).toBeCloseTo(17.0)
  })
})

describe('drift + correction', () => {
  const master = FRONT_START + 10_000
  it('computes video-vs-master drift in seconds', () => {
    expect(driftSeconds(9.8, FRONT[0], master)).toBeCloseTo(-0.2)
    expect(videoAbsoluteMs(9.8, FRONT[0])).toBe(master - 200)
  })
  it('corrects only beyond 150 ms', () => {
    expect(needsCorrection(DRIFT_CORRECTION_SECONDS)).toBe(false)
    expect(needsCorrection(DRIFT_CORRECTION_SECONDS - 0.01)).toBe(false)
    expect(needsCorrection(DRIFT_CORRECTION_SECONDS + 0.01)).toBe(true)
    expect(needsCorrection(-0.2)).toBe(true)
  })
})
