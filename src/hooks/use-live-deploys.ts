import { useSyncExternalStore } from "react";

import { lastDeploys, onDeployEvents } from "@/lib/api";
import type { DeployStatus, LastDeploy } from "@/types";

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
/** Letzter abgeschlossener Deploy je Projekt aus der Datenbank */
let last = new Map<string, LastDeploy>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

async function reloadLast() {
  try {
    last = new Map((await lastDeploys()).map((d) => [d.projectId, d]));
    notify();
  } catch {
    // Nur Anzeige in der Seitenleiste; beim nächsten Deploy wird erneut geladen
  }
}
let subscription: Promise<unknown> | null = null;

function update(projectId: string, change: (live: LiveDeploy) => LiveDeploy) {
  const live = byProject.get(projectId);
  if (!live) return;
  byProject.set(projectId, change(live));
  notify();
}

/** Wird bei jedem Rendern aufgerufen; meldet sich aber nur beim ersten Mal an */
function ensureSubscribed() {
  if (subscription) return subscription;
  subscription = onDeployEvents({
    onOutput: (deployId, line) => {
      const projectId = projectOfDeploy.get(deployId);
      if (projectId) update(projectId, (live) => ({ ...live, lines: [...live.lines, line] }));
    },
    onFinished: (deployId, projectId, status) => {
      if (byProject.get(projectId)?.deployId === deployId) update(projectId, (live) => ({ ...live, status }));
      reloadLast();
    },
  });
  // Nur einmal; danach aktualisiert onFinished den Stand
  reloadLast();
  return subscription;
}

/** Vor dem Start aufrufen, damit keine frühe Ausgabezeile verloren geht */
export async function beginLiveDeploy(projectId: string, deployId: string) {
  await ensureSubscribed();
  projectOfDeploy.set(deployId, projectId);
  byProject.set(projectId, { deployId, projectId, status: "running", lines: [] });
  notify();
}

export function discardLiveDeploy(projectId: string) {
  byProject.delete(projectId);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLiveDeploy(projectId: string): LiveDeploy | undefined {
  ensureSubscribed();
  return useSyncExternalStore(subscribe, () => byProject.get(projectId));
}

/** Für die Seitenleiste: läuft gerade etwas, sonst Status des letzten Deploys */
export function useDeployStatus(projectId: string): { status: DeployStatus; startedAt?: string } | undefined {
  ensureSubscribed();
  const live = useSyncExternalStore(subscribe, () => byProject.get(projectId));
  const stored = useSyncExternalStore(subscribe, () => last.get(projectId));
  if (live?.status === "running") return { status: "running" };
  return stored;
}
