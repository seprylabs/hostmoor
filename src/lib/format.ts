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

export function sshTarget(server: { host: string; port: number; sshUser?: string | null }): string {
  const user = server.sshUser ? `${server.sshUser}@` : "";
  const port = server.port !== 22 ? `:${server.port}` : "";
  return `${user}${server.host}${port}`;
}
