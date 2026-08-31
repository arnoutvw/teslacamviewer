import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { ThemeProvider } from '@mui/material/styles'
import { theme } from './theme'

describe('App', () => {
  it('renders the app bar title and an empty body', () => {
    render(
      <ThemeProvider theme={theme}>
        <App />
      </ThemeProvider>,
    )
    expect(screen.getByText('TeslaCamViewer')).toBeInTheDocument()
    expect(screen.getByTestId('app-body')).toBeInTheDocument()
  })
})