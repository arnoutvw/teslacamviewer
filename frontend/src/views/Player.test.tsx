import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Player from './Player'
import type { EventDetailDto } from '../api/client'

vi.mock('../api/client', () => ({
  getEventDetail: vi.fn(),
}))

import { getEventDetail } from '../api/client'
const mockDetail = vi.mocked(getEventDetail)

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
    front: [{ camera: 'front', start: '2026-07-10T17:19:23', url: '/media/f/1-front.mp4', playable: true, estimatedSeconds: 60 }],
  },
  timeline: { start: '2026-07-10T17:19:23', end: '2026-07-10T17:20:23' },
}

beforeEach(() => mockDetail.mockResolvedValue(detail))
afterEach(cleanup)

describe('Player', () => {
  it('fetches the detail and renders all 6 tiles', async () => {
    render(<Player category="SentryClips" folder="f" onBack={vi.fn()} />)
    await waitFor(() => {
      for (const cam of ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar']) {
        expect(screen.getByTestId(`tile-${cam}`)).toBeInTheDocument()
      }
    })
    expect(mockDetail).toHaveBeenCalledWith('SentryClips', 'f')
  })

  it('grays out cameras without footage and rings the event camera', async () => {
    render(<Player category="SentryClips" folder="f" onBack={vi.fn()} />)
    await screen.findByTestId('tile-back')
    expect(screen.queryByTestId('video-back')).not.toBeInTheDocument() // no segment → gray tile
    expect(screen.getByTestId('tile-back')).toHaveStyle({ outline: '3px solid #ff1744' })
    // Only front has footage in this fixture → the other 5 tiles are gray.
    expect(screen.getAllByText('no footage')).toHaveLength(5)
  })

  it('has a working back button', async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(<Player category="SentryClips" folder="f" onBack={onBack} />)
    await screen.findByTestId('tile-front')
    await user.click(screen.getByRole('button', { name: /back to list/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})