import { useSyncExternalStore } from "react";

import { onSiteUpdate, siteOverview } from "@/lib/api";
import type { SiteStatus } from "@/types";

// Lives outside React; the Rust side sends the complete state on every change.
let byProject = new Map<string, SiteStatus>();
const listeners = new Set<() => void>();
let started = false;

function applySiteStatus(overview: SiteStatus[]) {
  byProject = new Map(overview.map((s) => [s.projectId, s]));
  listeners.forEach((l) => l());
}

function ensureStarted() {
  if (started) return;
  started = true;
  onSiteUpdate(applySiteStatus);
  siteOverview().then(applySiteStatus, () => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSiteStatus(projectId: string): SiteStatus | undefined {
  ensureStarted();
  return useSyncExternalStore(subscribe, () => byProject.get(projectId));
}

/** Whole days until the certificate expires, negative once expired */
export function daysLeft(expiresAt: number): number {
  return Math.floor((expiresAt * 1000 - Date.now()) / 86_400_000);
}
