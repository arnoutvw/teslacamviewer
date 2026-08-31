import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EventMap } from './EventMap'

describe('EventMap', () => {
  it('renders nothing without coordinates', () => {
    const { container } = render(<EventMap lat={null} lon={null} label={['A', 'B']} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when only one coordinate is present', () => {
    const { container } = render(<EventMap lat={51.3352} lon={null} label={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a map node with a caption when coordinates are present', () => {
    const { container } = render(<EventMap lat={51.3352} lon={6.35791} label={['Flugplatz', 'Grefrath']} />)
    expect(container.querySelector('.leaflet-container')).not.toBeNull()
    expect(container.textContent).toContain('Flugplatz')
  })
})