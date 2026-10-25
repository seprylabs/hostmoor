import { Pencil, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  favorite?: boolean;
  onToggleFavorite: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function DetailActions({ favorite, onToggleFavorite, onEdit, onDelete }: Props) {
  const favoriteLabel = favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen";
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="icon-sm" onClick={onToggleFavorite} title={favoriteLabel} aria-label={favoriteLabel}>
        <Star className={cn(favorite && "fill-amber-400 text-amber-400")} />
      </Button>
      <Button variant="outline" size="sm" onClick={onEdit}>
        <Pencil /> Bearbeiten
      </Button>
      <Button variant="outline" size="icon-sm" onClick={onDelete} title="Löschen" aria-label="Löschen">
        <Trash2 />
      </Button>
    </div>
  );
}
