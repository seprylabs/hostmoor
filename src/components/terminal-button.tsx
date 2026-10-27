import { useEffect, useState } from "react";
import { ChevronDown, SquareTerminal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listTerminals, openTerminal } from "@/lib/api";
import type { TerminalApp } from "@/types";

const TERMINAL_KEY = "stackport-terminal";
/** Wert für „macOS-Standard“: die App, die im Finder für .command-Dateien eingestellt ist */
const DEFAULT = "default";

// Installierte Apps ändern sich selten, einmal pro Start reicht
let terminalsPromise: Promise<TerminalApp[]> | null = null;
const loadTerminals = () => (terminalsPromise ??= listTerminals().catch(() => []));

function loadChoice(): string {
  try {
    return localStorage.getItem(TERMINAL_KEY) ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Öffnet ein Terminal mit einer SSH-Sitzung zum Server, optional direkt im Ordner `dir`.
 *  Über den Pfeil lässt sich die Terminal-App wählen (Ghostty, iTerm2 …) */
export function TerminalButton({ serverId, dir }: { serverId: string; dir?: string | null }) {
  const [terminals, setTerminals] = useState<TerminalApp[]>([]);
  const [choice, setChoice] = useState(loadChoice);

  useEffect(() => {
    loadTerminals().then(setTerminals);
  }, []);

  // Gewählte App deinstalliert → wieder macOS-Standard
  const selected = terminals.find((t) => t.id === choice);
  const label = selected?.name ?? "Terminal";

  const choose = (id: string) => {
    setChoice(id);
    try {
      localStorage.setItem(TERMINAL_KEY, id);
    } catch {
      // nur Komfort, darf fehlschlagen
    }
  };

  const open = async () => {
    try {
      await openTerminal(serverId, dir, selected?.id ?? null);
    } catch (e) {
      toast.error("Terminal konnte nicht geöffnet werden", { description: String(e) });
    }
  };

  return (
    <div className="flex">
      <Button
        size="sm"
        variant="outline"
        className="rounded-r-none"
        onClick={open}
        title={dir ? `SSH-Sitzung in ${label} öffnen, direkt in ${dir}` : `SSH-Sitzung in ${label} öffnen`}
      >
        <SquareTerminal /> {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="outline"
            className="rounded-l-none border-l-0"
            aria-label="Terminal-App wählen"
            title="Terminal-App wählen"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuLabel>Öffnen mit</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={selected?.id ?? DEFAULT} onValueChange={choose}>
            <DropdownMenuRadioItem value={DEFAULT}>macOS-Standard</DropdownMenuRadioItem>
            {terminals.length > 0 && <DropdownMenuSeparator />}
            {terminals.map((t) => (
              <DropdownMenuRadioItem key={t.id} value={t.id}>
                {t.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
