import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import EventList from './EventList'
import { theme } from '../theme'
import type { EventSummaryDto } from '../api/client'

vi.mock('../api/client', () => ({
  CATEGORIES: ['RecentClips', 'SavedClips', 'SentryClips'] as const,
  listEvents: vi.fn(),
}))

import { listEvents } from '../api/client'
const mockList = vi.mocked(listEvents)

const event: EventSummaryDto = {
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

beforeEach(() => vi.clearAllMocks())

afterEach(cleanup)

const renderView = (ui: ReactElement): ReturnType<typeof render> =>
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

describe('EventList', () => {
  it('fetches and renders rows with timestamp, location, reason and camera', async () => {
    mockList.mockResolvedValue([event])
    renderView(<EventList onOpen={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('2026-07-10 17:20:19')).toBeInTheDocument())
    expect(screen.getByText('Flugplatz, Grefrath')).toBeInTheDocument()
    expect(screen.getByText('Sentry · object detection')).toBeInTheDocument()
    expect(screen.getByText('right_pillar')).toBeInTheDocument()
    expect(mockList).toHaveBeenCalledWith('RecentClips') // default tab
  })

  it('shows zero state when the list is empty', async () => {
    mockList.mockResolvedValue([])
    renderView(<EventList onOpen={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/No events/i)).toBeInTheDocument())
  })

  it('switches tab and fetches that category', async () => {
    mockList.mockResolvedValue([])
    const user = userEvent.setup()
    renderView(<EventList onOpen={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Sentry' }))
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('SentryClips'))
  })

  it('opens the player on row click', async () => {
    mockList.mockResolvedValue([event])
    const onOpen = vi.fn()
    const user = userEvent.setup()
    renderView(<EventList onOpen={onOpen} />)
    await waitFor(() => expect(screen.getByText('2026-07-10 17:20:19')).toBeInTheDocument())
    await user.click(screen.getByText('2026-07-10 17:20:19'))
    expect(onOpen).toHaveBeenCalledWith('RecentClips', '2026-07-10_17-21-39')
  })

  it('disables rows for unplayable events', async () => {
    mockList.mockResolvedValue([{ ...event, playable: false }])
    renderView(<EventList onOpen={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /2026-07-10 17:20:19/ })).toBeDisabled())
  })

  it('shows an error and refetches on Retry', async () => {
    mockList.mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue([event])
    const user = userEvent.setup()
    renderView(<EventList onOpen={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/Failed to load events/i)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('2026-07-10 17:20:19')).toBeInTheDocument())
    expect(mockList).toHaveBeenCalledTimes(2)
  })
})
