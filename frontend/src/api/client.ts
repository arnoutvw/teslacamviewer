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
}

export interface SegmentDto {
  camera: string
  start: string
  url: string
  playable: boolean
  estimatedSeconds: number
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
