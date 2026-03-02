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
