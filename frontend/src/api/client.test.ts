import { afterEach, describe, expect, it, vi } from 'vitest'
import { getEventDetail, listEvents } from './client'

afterEach(() => vi.unstubAllGlobals())

const summary = {
  category: 'SentryClips',
  folder: '2026-07-10_17-21-39',
  timestamp: '2026-07-10T17:20:19',
  timestampSource: 'event',
  city: 'Grefrath',
  street: 'Flugplatz',
  reason: 'sentry_aware_object_detection',
  lat: 51.3352,
  lon: 6.35791,
  camera: 'right_pillar',
  cameraIndex: 5,
  segmentCount: 2,
  playable: true,
}

describe('listEvents', () => {
  it('returns the JSON body on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([summary]), { status: 200 })))
    await expect(listEvents('SentryClips')).resolves.toEqual([summary])
    expect(fetch).toHaveBeenCalledWith('/api/events/SentryClips')
  })

  it('resolves [] on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"Not Found"}', { status: 404 })))
    await expect(listEvents('RecentClips')).resolves.toEqual([])
  })

  it('throws on other errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(listEvents('RecentClips')).rejects.toThrow('HTTP 500')
  })
})

describe('getEventDetail', () => {
  const detail = { summary, segmentsByCamera: {}, timeline: { start: '2026-07-10T17:19:23', end: '2026-07-10T17:20:24' } }

  it('returns the JSON body on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 })))
    await expect(getEventDetail('SentryClips', '2026-07-10_17-21-39')).resolves.toEqual(detail)
    expect(fetch).toHaveBeenCalledWith('/api/events/SentryClips/2026-07-10_17-21-39')
  })

  it('resolves null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    await expect(getEventDetail('SentryClips', 'missing')).resolves.toBeNull()
  })
})