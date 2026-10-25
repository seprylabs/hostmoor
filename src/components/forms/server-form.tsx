import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { providerLabel } from "@/lib/format";
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
            <FieldLabel htmlFor="server-name">Name</FieldLabel>
            <Input
              id="server-name"
              autoFocus
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="z. B. web-01"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="server-provider">Anbieter</FieldLabel>
            <OptionSelect
              id="server-provider"
              value={draft.provider}
              onChange={(v) => v && set("provider", v as Provider)}
              options={Object.entries(providerLabel).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-4">
          <Field>
            <FieldLabel htmlFor="server-host">Host / IP</FieldLabel>
            <Input
              id="server-host"
              value={draft.host}
              onChange={(e) => set("host", e.target.value)}
              placeholder="203.0.113.10"
              className="font-mono"
            />
          </Field>
          <Field data-invalid={!portValid || undefined}>
            <FieldLabel htmlFor="server-port">Port</FieldLabel>
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
          <FieldLabel htmlFor="server-user">SSH-Benutzer</FieldLabel>
          <Input
            id="server-user"
            value={draft.sshUser}
            onChange={(e) => set("sshUser", e.target.value)}
            placeholder="z. B. deploy"
            className="font-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="server-key">Pfad zum SSH-Key</FieldLabel>
          <Input
            id="server-key"
            value={draft.sshKeyPath}
            onChange={(e) => set("sshKeyPath", e.target.value)}
            placeholder="~/.ssh/id_ed25519"
            className="font-mono"
          />
          <FieldDescription>
            Es wird nur der Pfad gespeichert. Die App öffnet die Key-Datei nie; sie wird später nur an
            <code className="mx-1">ssh -i</code>übergeben. Leer lassen, um den Standard-Key bzw. den SSH-Agent
            zu nutzen.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="server-customer">Gehört zu</FieldLabel>
          <OptionSelect
            id="server-customer"
            value={draft.customerId}
            onChange={(v) => set("customerId", v)}
            noneLabel="Eigener Server"
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="server-notes">Notizen</FieldLabel>
          <Textarea
            id="server-notes"
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Tarif, Besonderheiten, Zugänge zum Panel …"
          />
        </Field>
      </FieldGroup>
    </FormShell>
  );
}
