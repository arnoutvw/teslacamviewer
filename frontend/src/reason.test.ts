import { describe, expect, it } from 'vitest'
import { humanizeReason } from './reason'

describe('humanizeReason', () => {
  it('maps the known sentry reason', () =>
    expect(humanizeReason('sentry_aware_object_detection')).toBe('Sentry · object detection'))
  it('title-cases unknown reasons', () =>
    expect(humanizeReason('some_other_reason')).toBe('Some Other Reason'))
  it('returns null for null and empty', () => {
    expect(humanizeReason(null)).toBeNull()
    expect(humanizeReason('')).toBeNull()
  })
})