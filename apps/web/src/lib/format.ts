/** Presentation helpers shared across pages. */

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(value)} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Sentence-case label for SCREAMING_SNAKE enum values, e.g. IN_PROGRESS → "In progress". */
export function humanize(value: string): string {
  const out = value.toLowerCase().split('_').join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** YYYY-MM-DD for date inputs (local calendar). */
export function toDateInput(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Colour token for a status/outcome/priority enum value in <Badge>.
 * Neutral "muted" for anything unmapped.
 */
export function badgeClass(value: string): 'ok' | 'info' | 'warn' | 'good' | 'bad' | 'muted' {
  const tokens: Record<string, 'ok' | 'info' | 'warn' | 'good' | 'bad' | 'muted'> = {
    // case status
    OPEN: 'ok',
    IN_PROGRESS: 'info',
    RESOLVED: 'good',
    CLOSED: 'muted',
    // sample status
    RECEIVED: 'info',
    IN_REVIEW: 'warn',
    COMPLETED: 'good',
    REJECTED: 'bad',
    // task status
    TODO: 'muted',
    DONE: 'good',
    CANCELLED: 'muted',
    // priorities (case + task)
    CRITICAL: 'bad',
    HIGH: 'warn',
    MEDIUM: 'info',
    LOW: 'good',
    // result status
    RELEASED: 'good',
    PENDING: 'warn',
    NOT_AVAILABLE: 'muted',
    // row outcomes
    VALID: 'good',
    DUPLICATE: 'warn',
    // import status
    PREVIEWED: 'info',
    COMMITTED: 'good',
    COMMIT_FAILED: 'bad',
    FAILED: 'bad',
    // roles
    ADMIN: 'warn',
    STAFF: 'info',
  };
  return tokens[value] ?? 'muted';
}
