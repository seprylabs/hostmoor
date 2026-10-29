import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CustomerForm } from "@/components/forms/customer-form";
import { ProjectForm } from "@/components/forms/project-form";
import { ServerForm } from "@/components/forms/server-form";
import type { Customer, Project, Server } from "@/types";

export type EditorState =
  | { kind: "customer"; initial?: Customer }
  | {
      kind: "server";
      initial?: Server;
      defaultCustomerId?: string;
      /** Neuer Server wird nach dem Speichern direkt diesem Projekt zugeordnet */
      assignTo?: Project;
    }
  | { kind: "project"; initial?: Project; defaultCustomerId?: string; defaultServerId?: string };

const titleKeys = {
  customer: ["entityDialog.newCustomer", "entityDialog.editCustomer"],
  server: ["entityDialog.newServer", "entityDialog.editServer"],
  project: ["entityDialog.newProject", "common.editProject"],
} as const;

const descriptionKeys = {
  customer: "entityDialog.customerDescription",
  server: "entityDialog.serverDescription",
  project: "entityDialog.projectDescription",
} as const;

interface Props {
  editor: EditorState | null;
  customers: Customer[];
  servers: Server[];
  onClose: () => void;
  saveCustomer: (c: Customer) => Promise<boolean>;
  saveServer: (s: Server) => Promise<boolean>;
  saveProject: (p: Project) => Promise<boolean>;
  /** Wird nach erfolgreichem Speichern mit der ID aufgerufen */
  onSaved: (kind: EditorState["kind"], id: string) => void;
}

export function EntityDialog({ editor, customers, servers, onClose, saveCustomer, saveServer, saveProject, onSaved }: Props) {
  const { t } = useTranslation();
  const submit =
    <T extends { id: string }>(kind: EditorState["kind"], save: (item: T) => Promise<boolean>) =>
    async (item: T) => {
      const ok = await save(item);
      if (ok) onSaved(kind, item.id);
      return ok;
    };

  return (
    <Dialog open={editor !== null} onOpenChange={(open) => !open && onClose()}>
      {editor && (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(titleKeys[editor.kind][editor.initial ? 1 : 0])}</DialogTitle>
            <DialogDescription>
              {editor.kind === "server" && editor.assignTo
                ? t("entityDialog.assignTo", { name: editor.assignTo.name })
                : t(descriptionKeys[editor.kind])}
            </DialogDescription>
          </DialogHeader>
          {editor.kind === "customer" && (
            <CustomerForm initial={editor.initial} onCancel={onClose} onSubmit={submit("customer", saveCustomer)} />
          )}
          {editor.kind === "server" && (
            <ServerForm
              initial={editor.initial}
              defaultCustomerId={editor.defaultCustomerId}
              customers={customers}
              onCancel={onClose}
              onSubmit={submit("server", saveServer)}
            />
          )}
          {editor.kind === "project" && (
            <ProjectForm
              initial={editor.initial}
              defaultCustomerId={editor.defaultCustomerId}
              defaultServerId={editor.defaultServerId}
              customers={customers}
              servers={servers}
              onCancel={onClose}
              onSubmit={submit("project", saveProject)}
            />
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
