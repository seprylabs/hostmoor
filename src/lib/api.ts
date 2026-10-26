import { invoke, isTauri } from "@tauri-apps/api/core";

import type { ConnectionResult, Customer, EntityKind, Project, Server, Snapshot } from "@/types";

// Im Browser (npm run dev ohne Tauri) landen die Daten im localStorage,
// damit sich die Oberfläche auch ohne Rust-Backend ausprobieren lässt.
const BROWSER_KEY = "stackport-dev-data";

function browserLoad(): Snapshot {
  try {
    const raw = localStorage.getItem(BROWSER_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // leerer Speicher
  }
  return { customers: [], servers: [], projects: [] };
}

function browserUpdate(fn: (data: Snapshot) => void) {
  const data = browserLoad();
  fn(data);
  localStorage.setItem(BROWSER_KEY, JSON.stringify(data));
}

function upsert<T extends { id: string }>(list: T[], item: T) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = { ...list[i], ...item };
  else list.push(item);
}

export async function loadAll(): Promise<Snapshot> {
  if (isTauri()) return invoke<Snapshot>("load_all");
  const data = browserLoad();
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "de");
  return {
    customers: data.customers.sort(byName),
    servers: data.servers.sort(byName),
    projects: data.projects.sort(byName),
  };
}

export async function saveCustomer(customer: Customer): Promise<void> {
  if (isTauri()) return invoke("save_customer", { customer });
  browserUpdate((d) => upsert(d.customers, customer));
}

export async function saveServer(server: Server): Promise<void> {
  if (isTauri()) return invoke("save_server", { server });
  // facts gehören dem SSH-Check und werden beim Speichern nicht überschrieben
  const { facts: _facts, ...rest } = server;
  browserUpdate((d) => upsert(d.servers, rest as Server));
}

export async function saveProject(project: Project): Promise<void> {
  if (isTauri()) return invoke("save_project", { project });
  browserUpdate((d) => upsert(d.projects, project));
}

export async function deleteEntity(kind: EntityKind, id: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_entity", { kind, id });
    return;
  }
  // Gleiches Verhalten wie die Fremdschlüssel in SQLite
  browserUpdate((d) => {
    if (kind === "customer") {
      d.customers = d.customers.filter((c) => c.id !== id);
      d.projects = d.projects.filter((p) => p.customerId !== id);
      d.servers.forEach((s) => s.customerId === id && (s.customerId = null));
    } else if (kind === "server") {
      d.servers = d.servers.filter((s) => s.id !== id);
      d.projects.forEach((p) => p.serverId === id && (p.serverId = null));
    } else {
      d.projects = d.projects.filter((p) => p.id !== id);
    }
  });
}

export async function setFavorite(kind: EntityKind, id: string, favorite: boolean): Promise<void> {
  if (isTauri()) return invoke("set_favorite", { kind, id, favorite });
  browserUpdate((d) => {
    const list: { id: string; favorite?: boolean }[] =
      kind === "customer" ? d.customers : kind === "server" ? d.servers : d.projects;
    const item = list.find((x) => x.id === id);
    if (item) item.favorite = favorite;
  });
}

function backupFileName() {
  return `stackport-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

const backupFilter = [{ name: "StackPort-Sicherung", extensions: ["json"] }];

/** Fragt nach einem Speicherort und schreibt das Backup; false, wenn abgebrochen */
export async function exportBackup(): Promise<boolean> {
  const exportedAt = new Date().toISOString();
  if (!isTauri()) {
    const data = { app: "StackPort", formatVersion: 1, exportedAt, ...browserLoad() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: backupFileName() });
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: backupFileName(), filters: backupFilter });
  if (!path) return false;
  await invoke("export_backup", { path, exportedAt });
  return true;
}

/** Fragt nach einer Backup-Datei; null, wenn abgebrochen */
export async function pickBackupFile(): Promise<string | null> {
  if (!isTauri()) throw new Error("Import ist nur in der App möglich, nicht im Browser.");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ multiple: false, directory: false, filters: backupFilter });
  return typeof path === "string" ? path : null;
}

/** Ersetzt alle Daten durch das Backup */
export async function importBackup(path: string): Promise<void> {
  await invoke("import_backup", { path });
}

/** Prüft per SSH, ob die Anmeldung am Server klappt */
export async function testConnection(serverId: string): Promise<ConnectionResult> {
  if (!isTauri()) throw new Error("Der Verbindungstest ist nur in der App möglich, nicht im Browser.");
  return invoke<ConnectionResult>("test_connection", { id: serverId });
}
