import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { EntityKind } from "@/types";

export interface DeleteRequest {
  kind: EntityKind;
  id: string;
  name: string;
  /** Hinweis auf Folgen, z. B. mitgelöschte Projekte */
  consequence?: string;
}

const titleKey = {
  customer: "confirmDelete.customerTitle",
  server: "confirmDelete.serverTitle",
  project: "confirmDelete.projectTitle",
} as const satisfies Record<EntityKind, string>;

export function ConfirmDelete({
  request,
  onCancel,
  onConfirm,
}: {
  request: DeleteRequest | null;
  onCancel: () => void;
  onConfirm: (request: DeleteRequest) => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && onCancel()}>
      {request && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(titleKey[request.kind], { name: request.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {request.consequence ?? t("confirmDelete.cannotUndo")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => onConfirm(request)}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
