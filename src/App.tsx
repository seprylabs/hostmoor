import { useState } from "react";
import { toast } from "sonner";
import { Building2, MousePointerClick, Server as ServerIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app-sidebar";
import { ConfirmDelete, type DeleteRequest } from "@/components/confirm-delete";
import { CustomerDetail } from "@/components/customer-detail";
import { EntityDialog, type EditorState } from "@/components/entity-dialog";
import { ProjectDetail } from "@/components/project-detail";
import { ServerDetail } from "@/components/server-detail";
import { useStore } from "@/hooks/use-store";
import { pickBackupFile } from "@/lib/api";
import type { Selection } from "@/types";

function App() {
  const store = useStore();
  const { customers, servers, projects } = store;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);

  const chooseBackup = async () => {
    try {
      const path = await pickBackupFile();
      if (path) setImportPath(path);
    } catch (e) {
      toast.error("Import nicht möglich", { description: String(e) });
    }
  };

  const confirmImport = async () => {
    const path = importPath;
    setImportPath(null);
    if (path && (await store.importBackup(path))) setSelection(null);
  };

  const customer = selection?.kind === "customer" ? customers.find((c) => c.id === selection.id) : undefined;
  const server = selection?.kind === "server" ? servers.find((s) => s.id === selection.id) : undefined;
  const project = selection?.kind === "project" ? projects.find((p) => p.id === selection.id) : undefined;

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const confirmDelete = async (request: DeleteRequest) => {
    setDeleteRequest(null);
    if (await store.remove(request.kind, request.id)) setSelection(null);
  };

  const isEmpty = !store.loading && customers.length === 0 && servers.length === 0;

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh">
        <AppSidebar
          customers={customers}
          servers={servers}
          projects={projects}
          selection={selection}
          onSelect={setSelection}
          onCreate={(kind) => setEditor({ kind })}
          onExport={store.exportBackup}
          onImport={chooseBackup}
        />
        <SidebarInset className="min-h-0">
          {/* Ziehbereich für das Fenster über dem Inhalt */}
          <div data-tauri-drag-region className="h-8 shrink-0" />
          <ScrollArea className="min-h-0 flex-1">
            <main className="mx-auto max-w-5xl px-8 pb-8">
              {customer && (
                <CustomerDetail
                  customer={customer}
                  projects={projects.filter((p) => p.customerId === customer.id)}
                  servers={servers.filter(
                    (s) =>
                      s.customerId === customer.id ||
                      projects.some((p) => p.customerId === customer.id && p.serverId === s.id),
                  )}
                  onSelect={setSelection}
                  onEdit={() => setEditor({ kind: "customer", initial: customer })}
                  onToggleFavorite={() => store.setFavorite("customer", customer.id, !customer.favorite)}
                  onDelete={() => {
                    const n = projects.filter((p) => p.customerId === customer.id).length;
                    setDeleteRequest({
                      kind: "customer",
                      id: customer.id,
                      name: customer.name,
                      consequence:
                        n > 0
                          ? `${plural(n, "Projekt wird", "Projekte werden")} ebenfalls gelöscht. Server bleiben erhalten, nur ohne Kundenzuordnung.`
                          : "Server des Kunden bleiben erhalten, nur ohne Kundenzuordnung.",
                    });
                  }}
                  onAddProject={() => setEditor({ kind: "project", defaultCustomerId: customer.id })}
                  onAddServer={() => setEditor({ kind: "server", defaultCustomerId: customer.id })}
                />
              )}
              {server && (
                <ServerDetail
                  key={server.id}
                  server={server}
                  customer={customers.find((c) => c.id === server.customerId)}
                  projects={projects.filter((p) => p.serverId === server.id)}
                  onSelect={setSelection}
                  onCheck={() => store.checkServer(server.id)}
                  onEdit={() => setEditor({ kind: "server", initial: server })}
                  onToggleFavorite={() => store.setFavorite("server", server.id, !server.favorite)}
                  onDelete={() => {
                    const n = projects.filter((p) => p.serverId === server.id).length;
                    setDeleteRequest({
                      kind: "server",
                      id: server.id,
                      name: server.name,
                      consequence:
                        n > 0
                          ? `${plural(n, "Projekt bleibt", "Projekte bleiben")} erhalten, ist dann aber keinem Server mehr zugeordnet.`
                          : undefined,
                    });
                  }}
                  onAddProject={() =>
                    setEditor({
                      kind: "project",
                      defaultServerId: server.id,
                      defaultCustomerId: server.customerId ?? undefined,
                    })
                  }
                />
              )}
              {project && (
                <ProjectDetail
                  project={project}
                  customer={customers.find((c) => c.id === project.customerId)}
                  server={servers.find((s) => s.id === project.serverId)}
                  onSelect={setSelection}
                  onEdit={() => setEditor({ kind: "project", initial: project })}
                  onToggleFavorite={() => store.setFavorite("project", project.id, !project.favorite)}
                  onDelete={() => setDeleteRequest({ kind: "project", id: project.id, name: project.name })}
                />
              )}

              {!customer && !server && !project && (
                <div className="text-muted-foreground flex h-[60vh] flex-col items-center justify-center gap-4 text-sm">
                  {isEmpty ? (
                    <>
                      <p className="text-foreground text-lg font-medium">Willkommen bei StackPort</p>
                      <p>Leg los mit deinem ersten Kunden oder Server.</p>
                      <div className="flex gap-2">
                        <Button onClick={() => setEditor({ kind: "customer" })}>
                          <Building2 /> Kunde anlegen
                        </Button>
                        <Button variant="outline" onClick={() => setEditor({ kind: "server" })}>
                          <ServerIcon /> Server anlegen
                        </Button>
                      </div>
                    </>
                  ) : (
                    !store.loading && (
                      <>
                        <MousePointerClick className="size-6" />
                        Wähle links einen Kunden, ein Projekt oder einen Server aus.
                      </>
                    )
                  )}
                </div>
              )}
            </main>
          </ScrollArea>
        </SidebarInset>
      </SidebarProvider>

      <EntityDialog
        editor={editor}
        customers={customers}
        servers={servers}
        onClose={() => setEditor(null)}
        saveCustomer={store.saveCustomer}
        saveServer={store.saveServer}
        saveProject={store.saveProject}
        onSaved={(kind, id) => {
          setEditor(null);
          setSelection({ kind, id });
        }}
      />
      <ConfirmDelete request={deleteRequest} onCancel={() => setDeleteRequest(null)} onConfirm={confirmDelete} />
      <AlertDialog open={importPath !== null} onOpenChange={(open) => !open && setImportPath(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Backup wiederherstellen?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle aktuellen Kunden, Server und Projekte werden durch den Inhalt von
              <span className="text-foreground mx-1 font-mono break-all">{importPath?.split("/").pop()}</span>
              ersetzt. Exportiere vorher ein Backup, wenn du den aktuellen Stand behalten willst.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmImport}>
              Ersetzen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
