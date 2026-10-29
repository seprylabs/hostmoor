import { useCallback, useEffect, useState } from "react";
import i18n from "i18next";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { connectionHelp } from "@/lib/ssh-help";
import type { ConnectionResult, Customer, EntityKind, Project, Server, Snapshot } from "@/types";

const empty: Snapshot = { customers: [], servers: [], projects: [] };

/** So viele Server werden bei „Alle Server prüfen“ gleichzeitig geprüft */
const CHECK_ALL_PARALLEL = 3;

// i18n.t statt useTranslation: ein wechselndes t würde reload neu erzeugen und die Daten neu laden
export function useStore() {
  const [data, setData] = useState<Snapshot>(empty);
  const [loading, setLoading] = useState(true);
  /** Fortschritt von „Alle Server prüfen“, null = läuft nicht */
  const [checkAll, setCheckAll] = useState<{ done: number; total: number } | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api.loadAll());
    } catch (e) {
      toast.error(i18n.t("store.loadFailed"), { description: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Führt eine Änderung aus, lädt neu und meldet Fehler; liefert true bei Erfolg */
  const mutate = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      try {
        await action();
        await reload();
        toast.success(success);
        return true;
      } catch (e) {
        toast.error(i18n.t("common.saveFailed"), { description: String(e) });
        return false;
      }
    },
    [reload],
  );

  return {
    ...data,
    loading,
    saveCustomer: (c: Customer) => mutate(() => api.saveCustomer(c), i18n.t("store.customerSaved")),
    saveServer: (s: Server) => mutate(() => api.saveServer(s), i18n.t("store.serverSaved")),
    saveProject: (p: Project) => mutate(() => api.saveProject(p), i18n.t("store.projectSaved")),
    remove: (kind: EntityKind, id: string) => mutate(() => api.deleteEntity(kind, id), i18n.t("store.deleted")),
    setFavorite: (kind: EntityKind, id: string, favorite: boolean) =>
      mutate(
        () => api.setFavorite(kind, id, favorite),
        favorite ? i18n.t("store.favoriteAdded") : i18n.t("store.favoriteRemoved"),
      ),
    exportBackup: async () => {
      try {
        if (await api.exportBackup()) toast.success(i18n.t("store.backupSaved"));
      } catch (e) {
        toast.error(i18n.t("store.exportFailed"), { description: String(e) });
      }
    },
    setDeployScript: (projectId: string, script: string | null) =>
      mutate(() => api.setDeployScript(projectId, script), i18n.t("store.deployScriptSaved")),
    checkAll,
    /** Prüft alle Server nacheinander (wenige parallel) und fasst das Ergebnis zusammen */
    checkAllServers: async () => {
      const servers = data.servers;
      if (servers.length === 0 || checkAll) return;
      const failures: string[] = [];
      let done = 0;
      setCheckAll({ done, total: servers.length });
      const toastId = toast.loading(i18n.t("store.checking", { count: servers.length }));

      const queue = [...servers];
      const worker = async () => {
        for (let server = queue.shift(); server; server = queue.shift()) {
          try {
            const { connectionError } = await api.checkServer(server.id);
            if (connectionError) failures.push(`${server.name}: ${connectionHelp(connectionError.status, server).title}`);
          } catch (e) {
            failures.push(`${server.name}: ${String(e)}`);
          }
          done += 1;
          setCheckAll({ done, total: servers.length });
          toast.loading(i18n.t("store.checkProgress", { done, total: servers.length }), { id: toastId });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CHECK_ALL_PARALLEL, servers.length) }, worker));
      await reload();
      setCheckAll(null);

      const ok = servers.length - failures.length;
      if (failures.length === 0) {
        toast.success(i18n.t("store.allChecked", { count: ok }), { id: toastId });
      } else {
        toast.error(i18n.t("store.partiallyChecked", { ok, count: servers.length }), {
          id: toastId,
          description: failures.join("\n"),
          classNames: { description: "whitespace-pre-line" },
          duration: 15_000,
        });
      }
    },
    /** Liefert bei Verbindungsproblemen die Ursache, damit die Einrichtungshilfe sie anzeigen kann */
    checkServer: async (id: string): Promise<ConnectionResult | null> => {
      try {
        const { connectionError } = await api.checkServer(id);
        if (connectionError) {
          toast.error(i18n.t("store.noConnection"), { description: i18n.t("store.noConnectionHint") });
          return connectionError;
        }
        await reload();
        toast.success(i18n.t("store.serverChecked"));
      } catch (e) {
        toast.error(i18n.t("store.checkFailed"), { description: String(e) });
      }
      return null;
    },
    importBackup: (path: string) => mutate(() => api.importBackup(path), i18n.t("store.backupRestored")),
  };
}
