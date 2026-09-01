import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTokens,
  fetchKeys,
  getEventDetail,
  getValidAccessToken,
  listEvents,
  loadTokens,
  refreshTokens,
  saveTokens,
  type KeyItemDto,
} from './client'

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

describe('token storage', () => {
  const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: 12345 }

  beforeEach(() => localStorage.clear())

  it('loadTokens returns null when unset', () => {
    expect(loadTokens()).toBeNull()
  })

  it('saveTokens/loadTokens round-trip', () => {
    saveTokens(tokens)
    expect(loadTokens()).toEqual(tokens)
  })

  it('clearTokens removes', () => {
    saveTokens(tokens)
    clearTokens()
    expect(loadTokens()).toBeNull()
  })
})

describe('refreshTokens', () => {
  const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 60_000 }

  beforeEach(() => {
    localStorage.clear()
    saveTokens(tokens)
  })

  it('clears stored tokens and resolves null on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"refresh_failed"}', { status: 401 })))
    await expect(refreshTokens()).resolves.toBeNull()
    expect(loadTokens()).toBeNull()
  })

  it('throws on transient server errors without clearing tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))
    await expect(refreshTokens()).rejects.toThrow('HTTP 502')
    expect(loadTokens()).toEqual(tokens)
  })
})

describe('getValidAccessToken', () => {
  beforeEach(() => localStorage.clear())

  it('dedupes concurrent refreshes into a single /api/tesla/refresh call', async () => {
    saveTokens({ accessToken: 'stale', refreshToken: 'rt', expiresAt: Date.now() - 1000 })
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ accessToken: 'at2', refreshToken: 'rt2', expiresAt: Date.now() + 60_000 }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([getValidAccessToken(), getValidAccessToken()])
    expect(a).toBe('at2')
    expect(b).toBe('at2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('fetchKeys', () => {
  const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 60_000 }
  const item: KeyItemDto = {
    id: 'clip-1', vin: 'VIN', keyId: 1, timestamp: 123, wrappedKey: 'w', publicKey: 'p',
  }

  beforeEach(() => localStorage.clear())

  it('throws not_logged_in when no token is stored', async () => {
    await expect(fetchKeys([item])).rejects.toThrow('not_logged_in')
  })

  it('throws not_logged_in on 401 (expired token)', async () => {
    saveTokens(tokens)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not_logged_in"}', { status: 401 })))
    await expect(fetchKeys([item])).rejects.toThrow('not_logged_in')
    expect(fetch).toHaveBeenCalledWith('/api/keys/fetch', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer at' }),
    }))
  })

  it('surfaces the batch-level error field from a Tesla-side failure (HTTP 200)', async () => {
    saveTokens(tokens)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ results: [{ id: 'clip-1', status: 'failed' }], fetched: 0, error: 'akamai_blocked' }), { status: 200 })),
    )
    await expect(fetchKeys([item])).resolves.toEqual({
      results: [{ id: 'clip-1', status: 'failed' }],
      fetched: 0,
      error: 'akamai_blocked',
    })
  })
})
