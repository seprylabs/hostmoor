import type { Provider, ServerFacts, Stack } from "@/types";

export const providerLabel: Record<Provider, string> = {
  hetzner: "Hetzner",
  netcup: "netcup",
  ionos: "IONOS",
  digitalocean: "DigitalOcean",
  aws: "AWS",
  other: "Sonstige",
};

export const stackLabel: Record<Stack, string> = {
  laravel: "Laravel",
  wordpress: "WordPress",
  static: "Statisch",
  other: "Sonstige",
};

export type Health = "ok" | "warn" | "unknown";

/** Grobe Ampel: Warnung ab 85 % RAM oder Plattenbelegung */
export function serverHealth(facts?: ServerFacts | null): Health {
  if (!facts) return "unknown";
  const memPct = facts.memory.usedMb / facts.memory.totalMb;
  const diskFull = facts.disks.some((d) => d.usedGb / d.totalGb >= 0.85);
  return memPct >= 0.85 || diskFull ? "warn" : "ok";
}

export function percent(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0 ? `${days} T ${hours} Std` : `${hours} Std`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Ab diesem Alter gelten Server-Daten als veraltet */
export const STALE_AFTER_DAYS = 30;

export function ageInDays(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

const relative = new Intl.RelativeTimeFormat("de", { numeric: "auto" });

/** "gerade eben", "vor 5 Minuten", "gestern", "vor 3 Tagen" … */
export function formatRelative(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return "gerade eben";
  if (abs < 3_600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3_600), "hour");
  if (abs < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  if (abs < 365 * 86_400) return relative.format(Math.round(seconds / (30 * 86_400)), "month");
  return relative.format(Math.round(seconds / (365 * 86_400)), "year");
}

export function sshTarget(server: { host: string; port: number; sshUser?: string | null }): string {
  const user = server.sshUser ? `${server.sshUser}@` : "";
  const port = server.port !== 22 ? `:${server.port}` : "";
  return `${user}${server.host}${port}`;
}
