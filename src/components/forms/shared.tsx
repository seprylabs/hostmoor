import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Radix-Select erlaubt keinen leeren Wert, daher ein Platzhalter für "nichts gewählt" */
const NONE = "__none";

export function useDraft<T extends object>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const set = <K extends keyof T>(key: K, value: T[K]) => setDraft((d) => ({ ...d, [key]: value }));
  return [draft, set] as const;
}

/** Leere/whitespace-Strings werden als null gespeichert */
export function clean(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function FormShell({
  onSubmit,
  onCancel,
  canSubmit,
  children,
}: {
  onSubmit: () => Promise<unknown>;
  onCancel: () => void;
  canSubmit: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const handle = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      await onSubmit();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handle} className="space-y-6">
      {children}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!canSubmit || busy}>
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function OptionSelect({
  id,
  value,
  onChange,
  options,
  noneLabel,
  placeholder,
}: {
  id?: string;
  value?: string | null;
  onChange: (value: string | null) => void;
  options: { value: string; label: string }[];
  /** Wenn gesetzt, kann "nichts" gewählt werden */
  noneLabel?: string;
  placeholder?: string;
}) {
  return (
    <Select
      value={value ?? (noneLabel ? NONE : undefined)}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
