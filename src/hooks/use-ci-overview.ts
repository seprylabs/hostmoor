import { useSyncExternalStore } from "react";

import { ciOverview, onCiUpdate } from "@/lib/api";
import type { CiRun, ProjectCi } from "@/types";

export interface ActiveRun {
  projectId: string;
  run: CiRun;
}

// Liegt außerhalb von React; der Rust-Teil schickt bei jeder Änderung den kompletten Stand.
let byProject = new Map<string, ProjectCi>();
let activeRuns: ActiveRun[] = [];
const listeners = new Set<() => void>();
let started = false;

function apply(overview: ProjectCi[]) {
  byProject = new Map(overview.map((p) => [p.projectId, p]));
  activeRuns = overview.flatMap((p) => p.active.map((run) => ({ projectId: p.projectId, run })));
  listeners.forEach((l) => l());
}

/** Wird bei jedem Rendern aufgerufen, meldet sich aber nur beim ersten Mal an */
function ensureStarted() {
  if (started) return;
  started = true;
  onCiUpdate(apply);
  ciOverview().then(apply, () => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProjectCi(projectId: string): ProjectCi | undefined {
  ensureStarted();
  return useSyncExternalStore(subscribe, () => byProject.get(projectId));
}

/** Alle wartenden und laufenden Pipelines über alle Projekte */
export function useActiveRuns(): ActiveRun[] {
  ensureStarted();
  return useSyncExternalStore(subscribe, () => activeRuns);
}
