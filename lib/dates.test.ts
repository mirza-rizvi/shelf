import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './dates';

const TS = Date.UTC(2026, 7, 21, 12, 30);

describe('dates', () => {
  it('formatDate matches the shared short-date options in any locale', () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(TS);
    expect(formatDate(TS)).toBe(expected);
  });

  it('formatDateTime matches toLocaleString', () => {
    expect(formatDateTime(TS)).toBe(new Date(TS).toLocaleString());
  });
});
