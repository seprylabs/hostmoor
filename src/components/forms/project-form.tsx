import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { stackLabel } from "@/lib/format";
import type { Customer, Project, Server, Stack } from "@/types";

import { clean, FormShell, OptionSelect, useDraft } from "./shared";

interface Props {
  initial?: Project;
  defaultCustomerId?: string;
  defaultServerId?: string;
  customers: Customer[];
  servers: Server[];
  onSubmit: (project: Project) => Promise<boolean>;
  onCancel: () => void;
}

export function ProjectForm({
  initial,
  defaultCustomerId,
  defaultServerId,
  customers,
  servers,
  onSubmit,
  onCancel,
}: Props) {
  const [draft, set] = useDraft({
    name: initial?.name ?? "",
    customerId: initial?.customerId ?? defaultCustomerId ?? (customers.length === 1 ? customers[0].id : null),
    serverId: initial ? (initial.serverId ?? null) : (defaultServerId ?? null),
    stack: initial?.stack ?? ("laravel" as Stack),
    domain: initial?.domain ?? "",
    path: initial?.path ?? "",
    repoUrl: initial?.repoUrl ?? "",
    notes: initial?.notes ?? "",
  });

  return (
    <FormShell
      canSubmit={draft.name.trim() !== "" && draft.customerId !== null}
      onCancel={onCancel}
      onSubmit={() =>
        onSubmit({
          id: initial?.id ?? crypto.randomUUID(),
          name: draft.name.trim(),
          customerId: draft.customerId!,
          serverId: draft.serverId,
          stack: draft.stack,
          domain: clean(draft.domain),
          path: clean(draft.path),
          repoUrl: clean(draft.repoUrl),
          notes: clean(draft.notes),
        })
      }
    >
      <FieldGroup>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="project-name">Name</FieldLabel>
            <Input
              id="project-name"
              autoFocus
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="z. B. Onlineshop"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="project-stack">Stack</FieldLabel>
            <OptionSelect
              id="project-stack"
              value={draft.stack}
              onChange={(v) => v && set("stack", v as Stack)}
              options={Object.entries(stackLabel).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="project-customer">Kunde</FieldLabel>
            <OptionSelect
              id="project-customer"
              value={draft.customerId}
              onChange={(v) => set("customerId", v)}
              placeholder="Kunde wählen"
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="project-server">Server</FieldLabel>
            <OptionSelect
              id="project-server"
              value={draft.serverId}
              onChange={(v) => set("serverId", v)}
              noneLabel="Noch kein Server"
              options={servers.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="project-domain">Domain</FieldLabel>
          <Input
            id="project-domain"
            value={draft.domain}
            onChange={(e) => set("domain", e.target.value)}
            placeholder="shop.example.de"
            className="font-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="project-path">Pfad auf dem Server</FieldLabel>
          <Input
            id="project-path"
            value={draft.path}
            onChange={(e) => set("path", e.target.value)}
            placeholder="/var/www/shop"
            className="font-mono"
          />
          <FieldDescription>Wird später für Deploy-Skripte verwendet.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="project-repo">Repository</FieldLabel>
          <Input
            id="project-repo"
            value={draft.repoUrl}
            onChange={(e) => set("repoUrl", e.target.value)}
            placeholder="https://github.com/firma/shop"
            className="font-mono"
          />
          <FieldDescription>Für die spätere Anzeige von GitHub- bzw. GitLab-Actions.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="project-notes">Notizen</FieldLabel>
          <Textarea id="project-notes" value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </FieldGroup>
    </FormShell>
  );
}
