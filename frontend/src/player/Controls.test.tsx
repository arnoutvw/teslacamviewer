import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { Controls } from './Controls'

describe('Controls', () => {
  const base = {
    playing: false,
    speed: 1,
    onToggle: vi.fn(),
    onSkip: vi.fn(),
    onSpeed: vi.fn(),
    positionMs: 0,
    eventMs: 30_000,
    timeline: { startMs: 0, endMs: 60_000 },
    onScrub: vi.fn(),
  }

  afterEach(cleanup)

  it('renders play, ±10s, speed buttons and a red event dot', () => {
    render(<Controls {...base} />)
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back 10/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /forward 10/i })).toBeInTheDocument()
    expect(screen.getByTestId('event-dot')).toBeInTheDocument()
  })

  it('calls onSkip with ±10 and onSpeed with the speed', async () => {
    const user = userEvent.setup()
    render(<Controls {...base} />)
    await user.click(screen.getByRole('button', { name: /back 10/i }))
    expect(base.onSkip).toHaveBeenCalledWith(-10)
    await user.click(screen.getByRole('button', { name: '2×' }))
    expect(base.onSpeed).toHaveBeenCalledWith(2)
  })

  it('positions the event dot proportionally', () => {
    render(<Controls {...base} />)
    const dot = screen.getByTestId('event-dot')
    expect(dot.style.left).toBe('50%')
  })
})