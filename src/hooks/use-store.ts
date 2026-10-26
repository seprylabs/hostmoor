import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import * as api from "@/lib/api";
import type { ConnectionResult, Customer, EntityKind, Project, Server, Snapshot } from "@/types";

const empty: Snapshot = { customers: [], servers: [], projects: [] };

export function useStore() {
  const [data, setData] = useState<Snapshot>(empty);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setData(await api.loadAll());
    } catch (e) {
      toast.error("Daten konnten nicht geladen werden", { description: String(e) });
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
        toast.error("Speichern fehlgeschlagen", { description: String(e) });
        return false;
      }
    },
    [reload],
  );

  return {
    ...data,
    loading,
    saveCustomer: (c: Customer) => mutate(() => api.saveCustomer(c), "Kunde gespeichert"),
    saveServer: (s: Server) => mutate(() => api.saveServer(s), "Server gespeichert"),
    saveProject: (p: Project) => mutate(() => api.saveProject(p), "Projekt gespeichert"),
    remove: (kind: EntityKind, id: string) => mutate(() => api.deleteEntity(kind, id), "Gelöscht"),
    setFavorite: (kind: EntityKind, id: string, favorite: boolean) =>
      mutate(
        () => api.setFavorite(kind, id, favorite),
        favorite ? "Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt",
      ),
    exportBackup: async () => {
      try {
        if (await api.exportBackup()) toast.success("Backup gespeichert");
      } catch (e) {
        toast.error("Export fehlgeschlagen", { description: String(e) });
      }
    },
    setDeployScript: (projectId: string, script: string | null) =>
      mutate(() => api.setDeployScript(projectId, script), "Deploy-Skript gespeichert"),
    /** Liefert bei Verbindungsproblemen die Ursache, damit die Einrichtungshilfe sie anzeigen kann */
    checkServer: async (id: string): Promise<ConnectionResult | null> => {
      try {
        const { connectionError } = await api.checkServer(id);
        if (connectionError) {
          toast.error("Keine Verbindung zum Server", { description: "Details und Hilfe stehen unter „Verbindung“." });
          return connectionError;
        }
        await reload();
        toast.success("Server geprüft");
      } catch (e) {
        toast.error("Prüfung fehlgeschlagen", { description: String(e) });
      }
      return null;
    },
    importBackup: (path: string) => mutate(() => api.importBackup(path), "Backup wiederhergestellt"),
  };
}
