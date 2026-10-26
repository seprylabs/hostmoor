import { useSyncExternalStore } from "react";

import { onDeployEvents } from "@/lib/api";
import type { DeployStatus } from "@/types";

/** Laufender oder gerade beendeter Deploy mit seiner Live-Ausgabe */
export interface LiveDeploy {
  deployId: string;
  projectId: string;
  status: DeployStatus;
  lines: string[];
}

// Liegt außerhalb von React, damit die Ausgabe beim Wechsel zwischen Projekten erhalten bleibt.
const byProject = new Map<string, LiveDeploy>();
const projectOfDeploy = new Map<string, string>();
const listeners = new Set<() => void>();
let subscription: Promise<unknown> | null = null;

function update(projectId: string, change: (live: LiveDeploy) => LiveDeploy) {
  const live = byProject.get(projectId);
  if (!live) return;
  byProject.set(projectId, change(live));
  listeners.forEach((l) => l());
}

function ensureSubscribed() {
  subscription ??= onDeployEvents({
    onOutput: (deployId, line) => {
      const projectId = projectOfDeploy.get(deployId);
      if (projectId) update(projectId, (live) => ({ ...live, lines: [...live.lines, line] }));
    },
    onFinished: (deployId, projectId, status) => {
      if (byProject.get(projectId)?.deployId === deployId) update(projectId, (live) => ({ ...live, status }));
    },
  });
  return subscription;
}

/** Vor dem Start aufrufen, damit keine frühe Ausgabezeile verloren geht */
export async function beginLiveDeploy(projectId: string, deployId: string) {
  await ensureSubscribed();
  projectOfDeploy.set(deployId, projectId);
  byProject.set(projectId, { deployId, projectId, status: "running", lines: [] });
  listeners.forEach((l) => l());
}

export function discardLiveDeploy(projectId: string) {
  byProject.delete(projectId);
  listeners.forEach((l) => l());
}

export function useLiveDeploy(projectId: string): LiveDeploy | undefined {
  ensureSubscribed();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => byProject.get(projectId),
  );
}
