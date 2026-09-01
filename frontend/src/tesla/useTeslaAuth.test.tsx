import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./teslaAuth', () => ({
  startLogin: vi.fn(),
  completeLogin: vi.fn(),
}))
vi.mock('../api/client', () => ({
  loadTokens: vi.fn(),
  clearTokens: vi.fn(),
}))

import { completeLogin, startLogin } from './teslaAuth'
import { clearTokens, loadTokens } from '../api/client'
import { useTeslaAuth } from './useTeslaAuth'

const mockStart = vi.mocked(startLogin)
const mockComplete = vi.mocked(completeLogin)
const mockLoad = vi.mocked(loadTokens)

const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: 999 }
const CALLBACK_URL = 'https://dashcam.tesla.com/callback?code=abc&state=xyz'

beforeEach(() => {
  vi.clearAllMocks()
  mockLoad.mockReturnValue(null)
})

afterEach(() => {
  localStorage.clear()
})

describe('useTeslaAuth', () => {
  it('reports loggedIn=false when no tokens are stored', () => {
    const { result } = renderHook(() => useTeslaAuth())
    expect(result.current.loggedIn).toBe(false)
    expect(result.current.busy).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('start() calls startLogin and clears error state', async () => {
    mockStart.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useTeslaAuth())
    await act(async () => {
      await result.current.start()
    })
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeNull()
  })

  it('confirm() with a valid URL calls completeLogin and flips loggedIn', async () => {
    mockLoad.mockReturnValueOnce(null).mockReturnValue(tokens)
    mockComplete.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useTeslaAuth())
    expect(result.current.loggedIn).toBe(false)
    await act(async () => {
      await result.current.confirm(CALLBACK_URL)
    })
    expect(mockComplete).toHaveBeenCalledWith(CALLBACK_URL)
    expect(result.current.loggedIn).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  it('confirm() with a garbage URL sets an error and stays logged out', async () => {
    mockComplete.mockRejectedValueOnce(new Error('No authorization code in pasted URL'))
    const { result } = renderHook(() => useTeslaAuth())
    await act(async () => {
      await result.current.confirm('not a url')
    })
    expect(result.current.loggedIn).toBe(false)
    expect(result.current.error).toMatch(/authorization code/i)
    expect(result.current.busy).toBe(false)
  })

  it('surfaces the state-mismatch message from completeLogin', async () => {
    mockComplete.mockRejectedValueOnce(
      new Error('State mismatch — paste the URL from the same login attempt'),
    )
    const { result } = renderHook(() => useTeslaAuth())
    await act(async () => {
      await result.current.confirm('https://dashcam.tesla.com/callback?code=abc&state=wrong')
    })
    expect(result.current.loggedIn).toBe(false)
    expect(result.current.error).toMatch(/State mismatch/)
  })

  it('logout() clears tokens and flips loggedIn off', () => {
    mockLoad.mockReturnValue(tokens)
    const { result } = renderHook(() => useTeslaAuth())
    expect(result.current.loggedIn).toBe(true)
    act(() => {
      result.current.logout()
    })
    expect(clearTokens).toHaveBeenCalledTimes(1)
    expect(result.current.loggedIn).toBe(false)
  })
})