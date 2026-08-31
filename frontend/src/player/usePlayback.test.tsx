import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { usePlayback } from './usePlayback'
import type { EventDetailDto } from '../api/client'

const seg = (camera: string, start: string, s: number): EventDetailDto['segmentsByCamera'][string][number] => ({
  camera,
  start,
  url: `/media/SentryClips/f/${start}-${camera}.mp4`,
  playable: true,
  estimatedSeconds: s,
})

const detail: EventDetailDto = {
  summary: {
    category: 'SentryClips',
    folder: 'f',
    timestamp: '2026-07-10T17:20:00',
    timestampSource: 'event',
    city: null, street: null, reason: null, lat: null, lon: null,
    camera: 'back', cameraIndex: 1, segmentCount: 1, playable: true,
  },
  segmentsByCamera: {
    front: [seg('front', '2026-07-10T17:19:23', 60)],
    back: [seg('back', '2026-07-10T17:19:23', 60)],
  },
  timeline: { start: '2026-07-10T17:19:23', end: '2026-07-10T17:20:23' },
}

function harness(onState: (s: ReturnType<typeof usePlayback>) => void): void {
  function Probe(): null {
    onState(usePlayback(detail))
    return null
  }
  render(<Probe />)
}

let latest: ReturnType<typeof usePlayback> | undefined
const capture = (s: ReturnType<typeof usePlayback>): void => { latest = s }

afterEach(cleanup)

describe('usePlayback', () => {
  it('starts 10s before the event, clamped to the timeline', () => {
    harness(capture)
    expect(latest!.ready).toBe(true)
    expect(latest!.positionMs).toBe(new Date('2026-07-10T17:19:50').getTime())
  })

  it('assigns each camera its segment at the initial position', () => {
    harness(capture)
    expect(latest!.assignments.front?.segment.camera).toBe('front')
    expect(latest!.assignments.back?.offsetSeconds).toBeCloseTo(27.0)
    expect(latest!.assignments.front?.offsetSeconds).toBeCloseTo(27.0)
  })

  it('toggle flips playing', () => {
    harness(capture)
    const before = latest!.playing
    act(() => { latest!.toggle() })
    const after = latest!.playing
    expect(after).toBe(!before)
  })

  it('seekTo clamps into the timeline', () => {
    harness(capture)
    act(() => { latest!.seekTo(new Date('2026-07-10T17:00:00').getTime()) })
    expect(latest!.positionMs).toBe(latest!.timeline.startMs)
  })

  it('skip moves position by the delta', () => {
    harness(capture)
    const before = latest!.positionMs
    act(() => { latest!.skip(10) })
    expect(latest!.positionMs).toBe(before + 10_000)
  })

  it('eventMs carries the red dot position', () => {
    harness(capture)
    expect(latest!.eventMs).toBe(new Date('2026-07-10T17:20:00').getTime())
  })

  it('bindCamera returns a per-camera setter', () => {
    harness(capture)
    const bind = latest!.bindCamera('front')
    expect(typeof bind).toBe('function')
  })

  it('advances the clock when the master element ends early', () => {
    harness(capture)
    const before = latest!.positionMs // initial position: 10 s before the event
    const el = document.createElement('video')
    el.dataset.camera = 'front' // handlers dispatch on the data-camera attribute
    act(() => { latest!.bindCamera('front')(el) })
    act(() => { el.dispatchEvent(new Event('ended')) })
    expect(latest!.positionMs).toBe(before + 1000)
  })

  it('reapplies the selected rate to reloaded elements', () => {
    harness(capture)
    const el = document.createElement('video')
    el.dataset.camera = 'front'
    act(() => {
      latest!.setSpeed(4) // element not bound yet → only the ref is updated
      latest!.bindCamera('front')(el)
      el.dispatchEvent(new Event('loadedmetadata'))
    })
    expect(el.playbackRate).toBe(4)
  })
})
