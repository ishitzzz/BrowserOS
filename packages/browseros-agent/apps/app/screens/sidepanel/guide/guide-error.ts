/** Transport errors can carry a structured server body instead of plain text. */
export function guideErrorText(message?: string): string {
  if (!message) return 'Something went wrong. Please try again.'
  let body: any = null
  try { body = JSON.parse(message) } catch { /* Ordinary model errors are already human-readable. */ }
  const error = body?.error
  const text = typeof error?.message === 'string' ? error.message : message
  // A provider 404 ("model no longer available") means the picked model was retired or renamed -
  // it is not a local-service failure, and saying so hides the fix (pick another model).
  if (error?.statusCode === 404 || /no longer available|not a valid model|unknown model|model.*not found|does not exist/i.test(text)) {
    return 'The selected model is no longer available from the provider. Pick another model in settings and try again.'
  }
  if (error && (error.code === 'unknown' || error.statusCode >= 500)) {
    return 'The local browser service could not complete this request. Please try again.'
  }
  return text
}
