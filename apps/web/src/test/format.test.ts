import { describe, expect, it } from 'vitest';

/**
 * Date formatting is presentation-only, but two properties matter for the
 * auditors' workflow: nulls render as an em-dash and dates are never shifted.
 */
describe('format helpers', () => {
  it('renders null/absent timestamps as an em-dash, never as "Invalid Date"', async () => {
    const { formatDate } = await import('../lib/format.js');
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('keeps the calendar date stable regardless of timezone', async () => {
    const { formatDate } = await import('../lib/format.js');
    // Fixed instant: 2026-04-05T12:00:00Z — must display as 05 Apr 2026.
    const out = formatDate('2026-04-05T12:00:00.000Z');
    expect(out).toMatch(/Apr 2026/);
    expect(out).toMatch(/05/);
  });

  it('humanizes SCREAMING_SNAKE_CASE for people reading the tables', async () => {
    const { humanize } = await import('../lib/format.js');
    expect(humanize('IN_PROGRESS')).toBe('In progress');
    expect(humanize('OPEN')).toBe('Open');
    expect(humanize('COMMIT_FAILED')).toBe('Commit failed');
  });
});
