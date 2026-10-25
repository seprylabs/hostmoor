import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "@/types";

import { clean, FormShell, useDraft } from "./shared";

interface Props {
  initial?: Customer;
  onSubmit: (customer: Customer) => Promise<boolean>;
  onCancel: () => void;
}

export function CustomerForm({ initial, onSubmit, onCancel }: Props) {
  const [draft, set] = useDraft({
    name: initial?.name ?? "",
    notes: initial?.notes ?? "",
  });

  return (
    <FormShell
      canSubmit={draft.name.trim() !== ""}
      onCancel={onCancel}
      onSubmit={() =>
        onSubmit({
          id: initial?.id ?? crypto.randomUUID(),
          name: draft.name.trim(),
          notes: clean(draft.notes),
        })
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="customer-name">Name</FieldLabel>
          <Input
            id="customer-name"
            autoFocus
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="z. B. Bäckerei Schmidt"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="customer-notes">Notizen</FieldLabel>
          <Textarea
            id="customer-notes"
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Ansprechpartner, Vertrag, Besonderheiten …"
          />
        </Field>
      </FieldGroup>
    </FormShell>
  );
}
