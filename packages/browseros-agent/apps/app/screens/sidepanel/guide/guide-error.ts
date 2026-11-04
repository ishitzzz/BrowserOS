/** Transport errors can carry a structured server body instead of plain text. */
export function guideErrorText(message?: string): string {
  if (!message) return 'Something went wrong. Please try again.'
  try {
    const body = JSON.parse(message)
    const error = body?.error
    if (error?.code === 'unknown' || error?.statusCode >= 500) {
      return 'The local browser service could not complete this request. Please try again.'
    }
    if (typeof error?.message === 'string') return error.message
  } catch {
    // Ordinary model errors are already human-readable.
  }
  return message
}
