import { describe, expect, it } from 'bun:test'
import { guideErrorText } from './guide-error'

describe('guideErrorText', () => {
  it('uses a readable message for internal errors', () => {
    expect(
      guideErrorText(
        JSON.stringify({
          error: { code: 'unknown', statusCode: 500, details: 'internal' },
        }),
      ),
    ).not.toContain('internal')
  })
  it('preserves an actionable provider error', () => {
    expect(
      guideErrorText(
        JSON.stringify({
          error: { code: 'rate_limit', message: 'Please wait a minute.' },
        }),
      ),
    ).toBe('Please wait a minute.')
  })
  it('preserves plain text errors', () => {
    expect(guideErrorText('Model unavailable')).toBe('Model unavailable')
  })
  it('handles missing messages', () => {
    expect(guideErrorText()).toContain('try again')
  })
})
