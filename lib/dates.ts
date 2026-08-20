// Shared date formatting. A module-level formatter is reused across calls —
// `toLocaleDateString` constructs a new Intl.DateTimeFormat every call, which
// adds up across hundreds of mounted tab rows.
const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function formatDate(epochMs: number): string {
  return dateFmt.format(epochMs);
}

export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}
