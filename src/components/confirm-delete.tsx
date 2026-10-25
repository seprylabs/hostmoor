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

const kindLabel: Record<EntityKind, string> = {
  customer: "Kunden",
  server: "Server",
  project: "Projekt",
};

export function ConfirmDelete({
  request,
  onCancel,
  onConfirm,
}: {
  request: DeleteRequest | null;
  onCancel: () => void;
  onConfirm: (request: DeleteRequest) => void;
}) {
  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && onCancel()}>
      {request && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {kindLabel[request.kind]} „{request.name}“ löschen?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {request.consequence ?? "Das lässt sich nicht rückgängig machen."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => onConfirm(request)}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
