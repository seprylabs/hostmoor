import { useTranslation } from "react-i18next";

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { stackLabel, stacks } from "@/lib/format";
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
  const { t } = useTranslation();
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
            <FieldLabel htmlFor="project-name">{t("forms.name")}</FieldLabel>
            <Input
              id="project-name"
              autoFocus
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("forms.project.namePlaceholder")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="project-stack">{t("forms.project.stack")}</FieldLabel>
            <OptionSelect
              id="project-stack"
              value={draft.stack}
              onChange={(v) => v && set("stack", v as Stack)}
              options={stacks.map((value) => ({ value, label: stackLabel(value) }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="project-customer">{t("forms.project.customer")}</FieldLabel>
            <OptionSelect
              id="project-customer"
              value={draft.customerId}
              onChange={(v) => set("customerId", v)}
              placeholder={t("forms.project.customerPlaceholder")}
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="project-server">{t("forms.project.server")}</FieldLabel>
            <OptionSelect
              id="project-server"
              value={draft.serverId}
              onChange={(v) => set("serverId", v)}
              noneLabel={t("forms.project.noServer")}
              options={servers.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="project-domain">{t("forms.project.domain")}</FieldLabel>
          <Input
            id="project-domain"
            value={draft.domain}
            onChange={(e) => set("domain", e.target.value)}
            placeholder={t("forms.project.domainPlaceholder")}
            className="font-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="project-path">{t("forms.project.path")}</FieldLabel>
          <Input
            id="project-path"
            value={draft.path}
            onChange={(e) => set("path", e.target.value)}
            placeholder="/var/www/shop"
            className="font-mono"
          />
          <FieldDescription>{t("forms.project.pathHint")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="project-repo">{t("forms.project.repo")}</FieldLabel>
          <Input
            id="project-repo"
            value={draft.repoUrl}
            onChange={(e) => set("repoUrl", e.target.value)}
            placeholder={t("forms.project.repoPlaceholder")}
            className="font-mono"
          />
          <FieldDescription>{t("forms.project.repoHint")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="project-notes">{t("forms.notes")}</FieldLabel>
          <Textarea id="project-notes" value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </FieldGroup>
    </FormShell>
  );
}
