import { Pencil, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  favorite?: boolean;
  onToggleFavorite: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function DetailActions({ favorite, onToggleFavorite, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  const favoriteLabel = favorite ? t("detailActions.removeFavorite") : t("detailActions.addFavorite");
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="icon-sm" onClick={onToggleFavorite} title={favoriteLabel} aria-label={favoriteLabel}>
        <Star className={cn(favorite && "fill-warning text-warning")} />
      </Button>
      <Button variant="outline" size="sm" onClick={onEdit}>
        <Pencil /> {t("common.edit")}
      </Button>
      <Button variant="outline" size="icon-sm" onClick={onDelete} title={t("common.delete")} aria-label={t("common.delete")}>
        <Trash2 />
      </Button>
    </div>
  );
}
