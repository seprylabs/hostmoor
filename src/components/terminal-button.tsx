import { SquareTerminal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { openTerminal } from "@/lib/api";

/** Öffnet das Mac-Terminal mit einer SSH-Sitzung zum Server, optional direkt im Ordner `dir` */
export function TerminalButton({ serverId, dir }: { serverId: string; dir?: string | null }) {
  const open = async () => {
    try {
      await openTerminal(serverId, dir);
    } catch (e) {
      toast.error("Terminal konnte nicht geöffnet werden", { description: String(e) });
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={open}
      title={dir ? `SSH-Sitzung im Terminal öffnen, direkt in ${dir}` : "SSH-Sitzung im Terminal öffnen"}
    >
      <SquareTerminal /> Terminal
    </Button>
  );
}
