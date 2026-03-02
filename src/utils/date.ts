import type { DateRange } from '../types.js';

/**
 * Get today's date range in local timezone (midnight to midnight)
 */
export function getTodayRange(): DateRange {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const until = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { since, until };
}

/**
 * Parse a YYYY-MM-DD string into start-of-day Date in local timezone
 */
export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Build a DateRange from --since and --until string options
 */
export function buildDateRange(since?: string, until?: string): DateRange {
  if (!since && !until) return getTodayRange();

  const sinceDate = since ? parseDate(since) : getTodayRange().since;
  const untilDate = until
    ? new Date(parseDate(until).getTime() + 24 * 60 * 60 * 1000 - 1)
    : getTodayRange().until;

  return { since: sinceDate, until: untilDate };
}

/**
 * Check if a timestamp (ISO string or epoch ms) falls within a date range.
 * Timestamps from JSONL are in UTC; we compare against local timezone boundaries.
 */
export function isInRange(timestamp: string, range: DateRange): boolean {
  const ts = new Date(timestamp);
  return ts >= range.since && ts <= range.until;
}

/**
 * Format a Date as YYYY-MM-DD in local timezone
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Generate an array of single-day DateRanges for each day in the given range.
 */
export function splitIntoDays(range: DateRange): { label: string; range: DateRange }[] {
  const days: { label: string; range: DateRange }[] = [];
  const cursor = new Date(range.since);
  while (cursor <= range.until) {
    const since = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 0, 0, 0, 0);
    const until = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 23, 59, 59, 999);
    days.push({ label: formatDate(since), range: { since, until } });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Generate an array of month-long DateRanges for each month in the given range.
 */
export function splitIntoMonths(range: DateRange): { label: string; range: DateRange }[] {
  const months: { label: string; range: DateRange }[] = [];
  const cursor = new Date(range.since.getFullYear(), range.since.getMonth(), 1);
  const endMonth = new Date(range.until.getFullYear(), range.until.getMonth(), 1);

  while (cursor <= endMonth) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    // Clamp bucket boundaries to the requested window
    const bucketStart = new Date(y, m, 1, 0, 0, 0, 0);
    const bucketEnd = new Date(y, m + 1, 0, 23, 59, 59, 999); // last day of month
    const since = bucketStart < range.since ? range.since : bucketStart;
    const until = bucketEnd > range.until ? range.until : bucketEnd;
    const label = `${y}-${String(m + 1).padStart(2, '0')}`;
    months.push({ label, range: { since, until } });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}
