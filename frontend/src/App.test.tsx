import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { ThemeProvider } from '@mui/material/styles'
import { theme } from './theme'

vi.mock('./api/client', () => ({
  CATEGORIES: ['RecentClips', 'SavedClips', 'SentryClips'] as const,
  listEvents: vi.fn().mockResolvedValue([]),
  loadTokens: vi.fn(() => null),
  clearTokens: vi.fn(),
}))

describe('App', () => {
  it('renders the app bar title and the event list', () => {
    render(
      <ThemeProvider theme={theme}>
        <App />
      </ThemeProvider>,
    )
    expect(screen.getByText('TeslaCamViewer')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Recent' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Saved' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sentry' })).toBeInTheDocument()
    expect(screen.queryByTestId('app-body')).not.toBeInTheDocument()
  })
})
