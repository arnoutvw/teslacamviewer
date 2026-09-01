import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import TeslaLoginDialog from './TeslaLoginDialog'
import { theme } from '../theme'
import type { TeslaAuthState } from './useTeslaAuth'

function makeAuth(overrides: Partial<TeslaAuthState> = {}): TeslaAuthState {
  return {
    loggedIn: false,
    busy: false,
    error: null,
    start: vi.fn().mockResolvedValue(true),
    confirm: vi.fn().mockResolvedValue(true),
    logout: vi.fn(),
    ...overrides,
  }
}

afterEach(cleanup)

describe('TeslaLoginDialog', () => {
  it('shows the login step with an explanation on open', () => {
    render(
      <ThemeProvider theme={theme}>
        <TeslaLoginDialog open onClose={vi.fn()} auth={makeAuth()} />
      </ThemeProvider>,
    )
    expect(screen.getByRole('button', { name: /login with tesla/i })).toBeInTheDocument()
    expect(screen.getByText(/page not found/i)).toBeInTheDocument()
  })

  it('disables the login button while busy', () => {
    render(
      <ThemeProvider theme={theme}>
        <TeslaLoginDialog open onClose={vi.fn()} auth={makeAuth({ busy: true })} />
      </ThemeProvider>,
    )
    expect(screen.getByRole('button', { name: /login with tesla/i })).toBeDisabled()
  })

  it('stays on the login step when start() fails', async () => {
    const user = userEvent.setup()
    function FailStartHarness(): JSX.Element {
      const [auth, setAuth] = useState<TeslaAuthState>(() => makeAuth())
      const wrapped: TeslaAuthState = {
        ...auth,
        start: vi.fn(async () => {
          setAuth((prev) => ({ ...prev, error: 'pkce mint failed: HTTP 500' }))
          return false
        }),
      }
      return <TeslaLoginDialog open onClose={vi.fn()} auth={wrapped} />
    }
    render(
      <ThemeProvider theme={theme}>
        <FailStartHarness />
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: /login with tesla/i }))
    expect(await screen.findByText('pkce mint failed: HTTP 500')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /login with tesla/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/callback url/i)).not.toBeInTheDocument()
  })

  it('advances to the paste step when start() succeeds', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider theme={theme}>
        <TeslaLoginDialog open onClose={vi.fn()} auth={makeAuth()} />
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: /login with tesla/i }))
    expect(await screen.findByLabelText(/callback url/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })

  it('closes after a successful confirm', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <ThemeProvider theme={theme}>
        <TeslaLoginDialog open onClose={onClose} auth={makeAuth()} />
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: /login with tesla/i }))
    await user.type(await screen.findByLabelText(/callback url/i), 'https://dashcam.tesla.com/callback?code=a&state=b')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  // Regression: handleConfirm must not read auth.error from a stale closure.
  // The harness mimics the real hook — confirm() updates auth state, causing a
  // re-render with a NEW auth object, while the old closure still holds the
  // previous one. A failed confirm must keep the dialog open and show the Alert.
  function StaleAuthHarness({ fail, onClose }: { fail: boolean; onClose: () => void }) {
    const [auth, setAuth] = useState<TeslaAuthState>(() => makeAuth())
    const wrapped: TeslaAuthState = {
      ...auth,
      confirm: vi.fn(async (pastedUrl: string) => {
        if (fail) {
          setAuth((prev) => ({
            ...prev,
            error: 'State mismatch — paste the URL from the same login attempt',
          }))
          return false
        }
        return true
      }),
    }
    return <TeslaLoginDialog open onClose={onClose} auth={wrapped} />
  }

  it('keeps the dialog open and shows the Alert when confirm fails (stale-closure regression)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <ThemeProvider theme={theme}>
        <StaleAuthHarness fail onClose={onClose} />
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: /login with tesla/i }))
    await user.type(await screen.findByLabelText(/callback url/i), 'https://dashcam.tesla.com/callback?code=a&state=wrong')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/State mismatch/)
    expect(onClose).not.toHaveBeenCalled()
  })
})