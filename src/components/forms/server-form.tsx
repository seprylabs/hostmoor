import { Trans, useTranslation } from "react-i18next";

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { providerLabel, providers } from "@/lib/format";
import type { Customer, Provider, Server } from "@/types";

import { clean, FormShell, OptionSelect, useDraft } from "./shared";

interface Props {
  initial?: Server;
  /** Vorbelegung beim Anlegen, z. B. aus der Kundenansicht */
  defaultCustomerId?: string;
  customers: Customer[];
  onSubmit: (server: Server) => Promise<boolean>;
  onCancel: () => void;
}

export function ServerForm({ initial, defaultCustomerId, customers, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const [draft, set] = useDraft({
    name: initial?.name ?? "",
    provider: initial?.provider ?? ("hetzner" as Provider),
    host: initial?.host ?? "",
    port: String(initial?.port ?? 22),
    sshUser: initial?.sshUser ?? "",
    sshKeyPath: initial?.sshKeyPath ?? "",
    customerId: initial ? (initial.customerId ?? null) : (defaultCustomerId ?? null),
    notes: initial?.notes ?? "",
  });

  const port = Number(draft.port);
  const portValid = Number.isInteger(port) && port > 0 && port <= 65535;

  return (
    <FormShell
      canSubmit={draft.name.trim() !== "" && draft.host.trim() !== "" && portValid}
      onCancel={onCancel}
      onSubmit={() =>
        onSubmit({
          id: initial?.id ?? crypto.randomUUID(),
          name: draft.name.trim(),
          provider: draft.provider,
          host: draft.host.trim(),
          port,
          sshUser: clean(draft.sshUser),
          sshKeyPath: clean(draft.sshKeyPath),
          customerId: draft.customerId,
          notes: clean(draft.notes),
        })
      }
    >
      <FieldGroup>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="server-name">{t("forms.name")}</FieldLabel>
            <Input
              id="server-name"
              autoFocus
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("forms.server.namePlaceholder")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="server-provider">{t("forms.server.provider")}</FieldLabel>
            <OptionSelect
              id="server-provider"
              value={draft.provider}
              onChange={(v) => v && set("provider", v as Provider)}
              options={providers.map((value) => ({ value, label: providerLabel(value) }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-4">
          <Field>
            <FieldLabel htmlFor="server-host">{t("forms.server.host")}</FieldLabel>
            <Input
              id="server-host"
              value={draft.host}
              onChange={(e) => set("host", e.target.value)}
              placeholder="203.0.113.10"
              className="font-mono"
            />
          </Field>
          <Field data-invalid={!portValid || undefined}>
            <FieldLabel htmlFor="server-port">{t("forms.server.port")}</FieldLabel>
            <Input
              id="server-port"
              inputMode="numeric"
              value={draft.port}
              onChange={(e) => set("port", e.target.value)}
              aria-invalid={!portValid}
              className="font-mono"
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="server-user">{t("forms.server.sshUser")}</FieldLabel>
          <Input
            id="server-user"
            value={draft.sshUser}
            onChange={(e) => set("sshUser", e.target.value)}
            placeholder={t("forms.server.sshUserPlaceholder")}
            className="font-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="server-key">{t("forms.server.sshKey")}</FieldLabel>
          <Input
            id="server-key"
            value={draft.sshKeyPath}
            onChange={(e) => set("sshKeyPath", e.target.value)}
            placeholder="~/.ssh/id_ed25519"
            className="font-mono"
          />
          <FieldDescription>
            <Trans i18nKey="forms.server.sshKeyHint" components={{ code: <code /> }} />
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="server-customer">{t("forms.server.owner")}</FieldLabel>
          <OptionSelect
            id="server-customer"
            value={draft.customerId}
            onChange={(v) => set("customerId", v)}
            noneLabel={t("forms.server.ownServer")}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="server-notes">{t("forms.notes")}</FieldLabel>
          <Textarea
            id="server-notes"
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder={t("forms.server.notesPlaceholder")}
          />
        </Field>
      </FieldGroup>
    </FormShell>
  );
}
