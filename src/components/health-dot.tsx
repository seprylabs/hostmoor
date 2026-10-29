import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { Health } from "@/lib/format";

const color: Record<Health, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  unknown: "bg-muted-foreground/40",
};

const labelKey = {
  ok: "health.ok",
  warn: "health.warn",
  unknown: "health.unknown",
} as const satisfies Record<Health, string>;

export function HealthDot({ health, className }: { health: Health; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      title={t(labelKey[health])}
      aria-label={t(labelKey[health])}
      className={cn("inline-block size-2 shrink-0 rounded-full", color[health], className)}
    />
  );
}
