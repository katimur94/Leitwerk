import { cn } from "../cn";

export type StatusKind = "online" | "offline" | "disabled" | "busy";

const colors: Record<StatusKind, string> = {
  online: "var(--lw-success)",
  busy: "var(--lw-warning)",
  offline: "var(--lw-ink-faint)",
  disabled: "var(--lw-danger)",
};

export function StatusDot({
  status,
  className,
}: {
  status: StatusKind;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2 w-2 rounded-full", className)}
      style={{ backgroundColor: colors[status] }}
    />
  );
}
