import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
          <FieldLabel htmlFor="customer-name">{t("forms.name")}</FieldLabel>
          <Input
            id="customer-name"
            autoFocus
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={t("forms.customer.namePlaceholder")}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="customer-notes">{t("forms.notes")}</FieldLabel>
          <Textarea
            id="customer-notes"
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder={t("forms.customer.notesPlaceholder")}
          />
        </Field>
      </FieldGroup>
    </FormShell>
  );
}
