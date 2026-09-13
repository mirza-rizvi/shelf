// Shared date formatting. A module-level formatter is reused across calls —
// `toLocaleDateString` constructs a new Intl.DateTimeFormat every call, which
// adds up across hundreds of mounted tab rows. Results are memoized per
// timestamp (wholesale clear at the cap, mirroring lib/urls.ts) because the
// manager tab stays pinned open and re-renders the same rows repeatedly.
const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const DATE_CACHE_MAX = 4_096;

const dateCache = new Map<number, string>();
const dateTimeCache = new Map<number, string>();

function cacheDate(cache: Map<number, string>, epochMs: number, value: string): string {
  if (cache.size >= DATE_CACHE_MAX) cache.clear();
  cache.set(epochMs, value);
  return value;
}

export function formatDate(epochMs: number): string {
  return dateCache.get(epochMs) ?? cacheDate(dateCache, epochMs, dateFmt.format(epochMs));
}

export function formatDateTime(epochMs: number): string {
  return dateTimeCache.get(epochMs) ?? cacheDate(dateTimeCache, epochMs, new Date(epochMs).toLocaleString());
}
