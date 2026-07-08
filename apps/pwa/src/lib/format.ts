// Datumsanzeige: Intl.DateTimeFormat('de-DE'), DB immer UTC (CLAUDE.md).
const dateTime = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

const timeOnly = new Intl.DateTimeFormat("de-DE", { timeStyle: "medium" });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTime.format(new Date(iso));
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return timeOnly.format(new Date(iso));
}

/** "vor 12 s" / "vor 3 min" für Heartbeats. */
export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "nie";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `vor ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  return dateTime.format(new Date(iso));
}
