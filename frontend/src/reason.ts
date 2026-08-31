const KNOWN: Record<string, string> = {
  sentry_aware_object_detection: 'Sentry · object detection',
}

export function humanizeReason(reason: string | null): string | null {
  if (reason == null || reason.length === 0) return null
  const known = KNOWN[reason]
  if (known != null) return known
  return reason
    .split('_')
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
