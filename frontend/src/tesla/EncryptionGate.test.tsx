import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import EncryptionGate from './EncryptionGate'
import { theme } from '../theme'
import type { EventDetailDto, KeyItemDto, SegmentDto } from '../api/client'

vi.mock('../api/client', () => ({
  CATEGORIES: ['RecentClips', 'SavedClips', 'SentryClips'] as const,
  fetchKeys: vi.fn(),
  getValidAccessToken: vi.fn(),
  loadTokens: vi.fn(() => null),
  clearTokens: vi.fn(),
  exchangeCode: vi.fn(),
  saveTokens: vi.fn(),
}))

vi.mock('./teslaAuth', () => ({
  startLogin: vi.fn(),
  completeLogin: vi.fn(),
}))

import { fetchKeys, getValidAccessToken, loadTokens } from '../api/client'
import { startLogin, completeLogin } from './teslaAuth'

const mockFetchKeys = vi.mocked(fetchKeys)
const mockGetToken = vi.mocked(getValidAccessToken)
const mockLoadTokens = vi.mocked(loadTokens)
const mockStart = vi.mocked(startLogin)
const mockComplete = vi.mocked(completeLogin)

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadTokens.mockReturnValue(null)
  mockGetToken.mockResolvedValue(null)
  mockFetchKeys.mockResolvedValue({ results: [], fetched: 0 })
  mockStart.mockResolvedValue(undefined)
  mockComplete.mockResolvedValue(undefined)
})

afterEach(cleanup)

const renderView = (ui: ReactElement): ReturnType<typeof render> =>
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

const keyItem: KeyItemDto = {
  id: 'k1',
  vin: 'VIN1',
  keyId: 42,
  timestamp: 1720000000,
  wrappedKey: 'wrapped',
  publicKey: 'pub',
}

const otherKeyItem: KeyItemDto = { ...keyItem, id: 'k2', keyId: 43, timestamp: 1720000001 }

const seg = (start: string, encrypted: boolean, key: KeyItemDto | null): SegmentDto => ({
  camera: 'front',
  start,
  url: `/media/f/${start}-front.mp4`,
  playable: true,
  estimatedSeconds: 60,
  encrypted,
  keyItem: key,
})

function makeDetail(segments: SegmentDto[]): EventDetailDto {
  return {
    summary: {
      category: 'SentryClips',
      folder: 'f',
      timestamp: '2026-07-10T17:20:00',
      timestampSource: 'event',
      city: null, street: null, reason: null, lat: null, lon: null,
      camera: 'front', cameraIndex: 0, segmentCount: segments.length, playable: true, encrypted: true,
    },
    segmentsByCamera: { front: segments },
    timeline: { start: '2026-07-10T17:19:00', end: '2026-07-10T17:20:00' },
  }
}

const plainDetail = makeDetail([seg('2026-07-10T17:19:00', false, null)])

describe('EncryptionGate', () => {
  it('renders children immediately and does not call the key API when nothing is encrypted', async () => {
    renderView(<EncryptionGate detail={plainDetail}>CHILD</EncryptionGate>)
    expect(await screen.findByText('CHILD')).toBeInTheDocument()
    expect(mockGetToken).not.toHaveBeenCalled()
    expect(mockFetchKeys).not.toHaveBeenCalled()
  })

  it('shows the login prompt and no fetch when there is no token', async () => {
    mockGetToken.mockResolvedValue(null)
    renderView(
      <EncryptionGate detail={makeDetail([seg('s1', true, keyItem)])}>CHILD</EncryptionGate>,
    )
    expect(await screen.findByText(/encrypted clips/i)).toBeInTheDocument()
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument()
    expect(mockFetchKeys).not.toHaveBeenCalled()
  })

  it('shows a progress bar while fetching, then children when all keys are fetched', async () => {
    mockGetToken.mockResolvedValue('test-token')
    let resolveFetch: (r: { results: { id: string; status: string }[]; fetched: number }) => void = () => {}
    mockFetchKeys.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve }),
    )
    renderView(
      <EncryptionGate detail={makeDetail([seg('s1', true, keyItem)])}>CHILD</EncryptionGate>,
    )
    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument()
    resolveFetch({ results: [{ id: 'k1', status: 'fetched' }], fetched: 1 })
    expect(await screen.findByText('CHILD')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('dedupes identical key items into one fetch call', async () => {
    mockGetToken.mockResolvedValue('test-token')
    mockFetchKeys.mockResolvedValue({
      results: [{ id: 'k1', status: 'fetched' }, { id: 'k2', status: 'fetched' }],
      fetched: 2,
    })
    renderView(
      <EncryptionGate
        detail={makeDetail([
          seg('s1', true, keyItem),
          seg('s2', true, keyItem),
          seg('s3', true, otherKeyItem),
          seg('s4', false, null),
        ])}
      >
        CHILD
      </EncryptionGate>,
    )
    expect(await screen.findByText('CHILD')).toBeInTheDocument()
    expect(mockFetchKeys).toHaveBeenCalledOnce()
    expect(mockFetchKeys).toHaveBeenCalledWith([keyItem, otherKeyItem])
  })

  it('renders children plus a warning when Tesla returns no key for some clips', async () => {
    mockGetToken.mockResolvedValue('test-token')
    mockFetchKeys.mockResolvedValue({
      results: [{ id: 'k1', status: 'fetched' }, { id: 'k2', status: 'no_key' }],
      fetched: 1,
    })
    renderView(
      <EncryptionGate detail={makeDetail([seg('s1', true, keyItem)])}>CHILD</EncryptionGate>,
    )
    expect(await screen.findByText(/could not be decrypted/i)).toBeInTheDocument()
    expect(screen.getByText('CHILD')).toBeInTheDocument()
  })

  it('shows an error alert with Retry when the key fetch fails, and retries on click', async () => {
    mockGetToken.mockResolvedValue('test-token')
    mockFetchKeys.mockRejectedValueOnce(new Error('key fetch failed: HTTP 500'))
    const user = userEvent.setup()
    renderView(
      <EncryptionGate detail={makeDetail([seg('s1', true, keyItem)])}>CHILD</EncryptionGate>,
    )
    expect(await screen.findByText(/key fetch failed: HTTP 500/i)).toBeInTheDocument()
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('CHILD')).toBeInTheDocument()
  })

  it('maps a batch-level akamai_blocked error to an explicit blocked message with Retry', async () => {
    mockGetToken.mockResolvedValue('test-token')
    // KeysController reports Tesla-side failures with HTTP 200 + a batch-level
    // error field; per-item statuses come back as "failed".
    mockFetchKeys.mockResolvedValue({
      results: [{ id: 'k1', status: 'failed' }],
      fetched: 0,
      error: 'akamai_blocked',
    })
    const user = userEvent.setup()
    renderView(
      <EncryptionGate detail={makeDetail([seg('s1', true, keyItem)])}>CHILD</EncryptionGate>,
    )
    expect(await screen.findByText(/blocked by tesla/i)).toBeInTheDocument()
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument()
    mockFetchKeys.mockResolvedValue({ results: [{ id: 'k1', status: 'fetched' }], fetched: 1 })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('CHILD')).toBeInTheDocument()
  })

  it('routes api_error/network_error batch errors to the generic error alert', async () => {
    mockGetToken.mockResolvedValue('test-token')
    mockFetchKeys.mockResolvedValue({
      results: [{ id: 'k1', status: 'failed' }],
      fetched: 0,
      error: 'network_error',
    })
    renderView(
      <EncryptionGate detail={makeDetail([seg('s1', true, keyItem)])}>CHILD</EncryptionGate>,
    )
    expect(await screen.findByText(/network_error/i)).toBeInTheDocument()
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument()
    expect(screen.queryByText(/could not be decrypted/i)).not.toBeInTheDocument()
  })

  it('shows the login prompt when fetchKeys reports not_logged_in', async () => {
    mockGetToken.mockResolvedValue('test-token')
    mockFetchKeys.mockRejectedValue(new Error('not_logged_in'))
    renderView(
      <EncryptionGate detail={makeDetail([seg('s1', true, keyItem)])}>CHILD</EncryptionGate>,
    )
    expect(await screen.findByText(/encrypted clips/i)).toBeInTheDocument()
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument()
  })

  it('retries the key fetch automatically after a successful login', async () => {
    const user = userEvent.setup()
    renderView(
      <EncryptionGate detail={makeDetail([seg('s1', true, keyItem)])}>CHILD</EncryptionGate>,
    )
    // Logged out → login prompt; the fetch itself never ran.
    expect(await screen.findByText(/encrypted clips/i)).toBeInTheDocument()
    expect(mockFetchKeys).not.toHaveBeenCalled()

    // Open the login dialog and walk through start → paste → confirm.
    await user.click(screen.getByRole('button', { name: /log in with tesla/i }))
    expect(await screen.findByText('Tesla account')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /login with tesla/i }))
    await screen.findByRole('textbox')
    // Tokens exist by the time the user confirms, so the hook flips loggedIn…
    mockLoadTokens.mockReturnValue({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 })
    mockGetToken.mockResolvedValue('test-token')
    mockFetchKeys.mockResolvedValue({ results: [{ id: 'k1', status: 'fetched' }], fetched: 1 })
    await user.type(screen.getByRole('textbox'), 'https://dashcam.tesla.com/callback?code=c&state=s')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    // …and the gate reruns the flow on its own, rendering the children.
    expect(await screen.findByText('CHILD')).toBeInTheDocument()
    expect(mockFetchKeys).toHaveBeenCalledOnce()
  })
})
