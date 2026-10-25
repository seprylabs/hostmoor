import { cn } from "@/lib/utils";
import type { Health } from "@/lib/format";

const color: Record<Health, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  unknown: "bg-muted-foreground/40",
};

const label: Record<Health, string> = {
  ok: "Alles in Ordnung",
  warn: "Speicher oder RAM fast voll",
  unknown: "Noch nicht geprüft",
};

export function HealthDot({ health, className }: { health: Health; className?: string }) {
  return (
    <span
      title={label[health]}
      aria-label={label[health]}
      className={cn("inline-block size-2 shrink-0 rounded-full", color[health], className)}
    />
  );
}
