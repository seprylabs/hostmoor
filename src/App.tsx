import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
import { loadSidebarWidth, SidebarResizer } from "@/components/sidebar-resizer";
import { ConfirmDelete, type DeleteRequest } from "@/components/confirm-delete";
import { CustomerDetail } from "@/components/customer-detail";
import { EntityDialog, type EditorState } from "@/components/entity-dialog";
import { ProjectDetail } from "@/components/project-detail";
import { ServerDetail } from "@/components/server-detail";
import { UpdateDialog } from "@/components/update-dialog";
import { useStore } from "@/hooks/use-store";
import { useUpdater } from "@/hooks/use-updater";
import { pickBackupFile } from "@/lib/api";
import type { Selection } from "@/types";

function App() {
  const { t } = useTranslation();
  const store = useStore();
  const updater = useUpdater();
  const { customers, servers, projects } = store;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);

  const chooseBackup = async () => {
    try {
      const path = await pickBackupFile();
      if (path) setImportPath(path);
    } catch (e) {
      toast.error(t("app.importFailed"), { description: String(e) });
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

  const confirmDelete = async (request: DeleteRequest) => {
    setDeleteRequest(null);
    if (await store.remove(request.kind, request.id)) setSelection(null);
  };

  const isEmpty = !store.loading && customers.length === 0 && servers.length === 0;

  return (
    <TooltipProvider>
      <SidebarProvider
        // Ohne Übergang folgt die Sidebar beim Ziehen direkt der Maus
        className="h-svh [&_[data-slot=sidebar-container]]:transition-none [&_[data-slot=sidebar-gap]]:transition-none"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
      >
        <AppSidebar
          customers={customers}
          servers={servers}
          projects={projects}
          selection={selection}
          onSelect={setSelection}
          onCreate={(kind) => setEditor({ kind })}
          onExport={store.exportBackup}
          onImport={chooseBackup}
          onCheckAll={store.checkAllServers}
          checkAll={store.checkAll}
          onCheckUpdates={updater.check}
          checkingUpdates={updater.checking}
        />
        <SidebarResizer width={sidebarWidth} onResize={setSidebarWidth} />
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
                          ? t("app.customerDeleteConsequence", { count: n })
                          : t("app.customerDeleteServersKept"),
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
                  onSaveKeyPath={(path) => store.saveServer({ ...server, sshKeyPath: path })}
                  onEdit={() => setEditor({ kind: "server", initial: server })}
                  onToggleFavorite={() => store.setFavorite("server", server.id, !server.favorite)}
                  onDelete={() => {
                    const n = projects.filter((p) => p.serverId === server.id).length;
                    setDeleteRequest({
                      kind: "server",
                      id: server.id,
                      name: server.name,
                      consequence:
                        n > 0 ? t("app.serverDeleteConsequence", { count: n }) : undefined,
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
                  key={project.id}
                  project={project}
                  customer={customers.find((c) => c.id === project.customerId)}
                  server={servers.find((s) => s.id === project.serverId)}
                  onSelect={setSelection}
                  onEdit={() => setEditor({ kind: "project", initial: project })}
                  onCreateServer={() =>
                    setEditor({ kind: "server", defaultCustomerId: project.customerId, assignTo: project })
                  }
                  onSaveDeployScript={(script) => store.setDeployScript(project.id, script)}
                  onToggleFavorite={() => store.setFavorite("project", project.id, !project.favorite)}
                  onDelete={() => setDeleteRequest({ kind: "project", id: project.id, name: project.name })}
                />
              )}

              {!customer && !server && !project && (
                <div className="text-muted-foreground flex h-[60vh] flex-col items-center justify-center gap-4 text-sm">
                  {isEmpty ? (
                    <>
                      <p className="text-foreground text-lg font-medium">{t("app.welcome.title")}</p>
                      <p>{t("app.welcome.text")}</p>
                      <div className="flex gap-2">
                        <Button onClick={() => setEditor({ kind: "customer" })}>
                          <Building2 /> {t("app.welcome.addCustomer")}
                        </Button>
                        <Button variant="outline" onClick={() => setEditor({ kind: "server" })}>
                          <ServerIcon /> {t("app.welcome.addServer")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    !store.loading && (
                      <>
                        <MousePointerClick className="size-6" />
                        {t("app.selectHint")}
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
        onSaved={async (kind, id) => {
          const assignTo = editor?.kind === "server" ? editor.assignTo : undefined;
          setEditor(null);
          if (assignTo) {
            // Aus der Projektansicht angelegt: zuordnen und beim Projekt bleiben
            await store.saveProject({ ...assignTo, serverId: id });
            return;
          }
          setSelection({ kind, id });
        }}
      />
      <ConfirmDelete request={deleteRequest} onCancel={() => setDeleteRequest(null)} onConfirm={confirmDelete} />
      <AlertDialog open={importPath !== null} onOpenChange={(open) => !open && setImportPath(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.restore.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                i18nKey="app.restore.description"
                values={{ file: importPath?.split("/").pop() }}
                components={{ file: <span className="text-foreground font-mono break-all" /> }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmImport}>
              {t("app.restore.replace")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UpdateDialog updater={updater} />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
