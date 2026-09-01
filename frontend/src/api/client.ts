export const CATEGORIES = ['RecentClips', 'SavedClips', 'SentryClips'] as const
export type Category = (typeof CATEGORIES)[number]

export interface EventSummaryDto {
  category: string
  folder: string
  timestamp: string
  timestampSource: 'event' | 'folder'
  city: string | null
  street: string | null
  reason: string | null
  lat: number | null
  lon: number | null
  camera: string | null
  cameraIndex: number | null
  segmentCount: number
  playable: boolean
  encrypted: boolean
}

export interface SegmentDto {
  camera: string
  start: string
  url: string
  playable: boolean
  estimatedSeconds: number
  encrypted: boolean
  keyItem: KeyItemDto | null
}

export interface KeyItemDto {
  id: string
  vin: string
  keyId: number
  timestamp: number
  wrappedKey: string
  publicKey: string
}

export interface TimelineDto {
  start: string
  end: string
}

export interface EventDetailDto {
  summary: EventSummaryDto
  segmentsByCamera: Record<string, SegmentDto[]>
  timeline: TimelineDto
}

async function parse<T>(res: Response): Promise<T | null> {
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function listEvents(category: Category): Promise<EventSummaryDto[]> {
  return (await parse<EventSummaryDto[]>(await fetch(`/api/events/${category}`))) ?? []
}

export async function getEventDetail(category: Category, folder: string): Promise<EventDetailDto | null> {
  return parse<EventDetailDto>(await fetch(`/api/events/${category}/${encodeURIComponent(folder)}`))
}

export interface TeslaTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

const TOKENS_KEY = 'tesla.tokens'

export function loadTokens(): TeslaTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY)
    return raw == null ? null : (JSON.parse(raw) as TeslaTokens)
  } catch {
    return null
  }
}

export function saveTokens(t: TeslaTokens): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t))
}

export function clearTokens(): void {
  localStorage.removeItem(TOKENS_KEY)
}

export async function refreshTokens(): Promise<TeslaTokens | null> {
  const tokens = loadTokens()
  if (tokens == null) return null
  const res = await fetch('/api/tesla/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  })
  if (res.status === 401) {
    // Token rejected — treat as logged out. Other failures may be transient
    // (5xx, network blips), so keep the stored tokens and let the caller retry.
    clearTokens()
    return null
  }
  if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status}`)
  const fresh = (await res.json()) as TeslaTokens
  saveTokens(fresh)
  return fresh
}

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = loadTokens()
  if (tokens == null) return null
  if (Date.now() < tokens.expiresAt) return tokens.accessToken
  const fresh = await refreshTokens()
  return fresh?.accessToken ?? null
}

export async function exchangeCode(code: string, verifier: string): Promise<TeslaTokens> {
  const res = await fetch('/api/tesla/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
  })
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`)
  return (await res.json()) as TeslaTokens
}

export interface FetchKeysResult {
  results: { id: string; status: string }[]
  fetched: number
  /**
   * Batch-level failure reported with HTTP 200 when the Tesla-side key fetch
   * could not run (per-item statuses come back as "failed" alongside it).
   */
  error?: 'akamai_blocked' | 'api_error' | 'network_error'
}

export async function fetchKeys(items: KeyItemDto[]): Promise<FetchKeysResult> {
  const token = await getValidAccessToken()
  if (token == null) throw new Error('not_logged_in')
  const res = await fetch('/api/keys/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items }),
  })
  // Backend signals an expired/missing token with 401 {"error":"not_logged_in"};
  // callers use this to show the login prompt.
  if (res.status === 401) throw new Error('not_logged_in')
  if (!res.ok) throw new Error(`key fetch failed: HTTP ${res.status}`)
  return (await res.json()) as FetchKeysResult
}
