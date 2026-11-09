import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Updater } from "@/hooks/use-updater";
import { openExternal } from "@/lib/api";

// Change together with the updater endpoint in tauri.conf.json when the repository moves
const RELEASES_URL = "https://github.com/seprylabs/hostmoor/releases";

/** Asks before installing an update found by useUpdater */
export function UpdateDialog({ updater }: { updater: Updater }) {
  const { t } = useTranslation();
  const { update, progress } = updater;
  const installing = progress !== null;

  return (
    <AlertDialog open={update !== null} onOpenChange={(open) => !open && updater.dismiss()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("update.title", { version: update?.version })}</AlertDialogTitle>
          <AlertDialogDescription>{t("update.description", { current: update?.currentVersion })}</AlertDialogDescription>
        </AlertDialogHeader>
        {installing ? (
          <div className="space-y-2">
            <Progress value={progress} />
            <p className="text-muted-foreground text-sm">{t("update.installing")}</p>
          </div>
        ) : (
          update && (
            <Button
              variant="link"
              className="h-auto justify-start p-0"
              onClick={() => void openExternal(`${RELEASES_URL}/tag/v${update.version.replace(/^v/, "")}`)}
            >
              {t("update.releaseNotes")} <ExternalLink />
            </Button>
          )
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={installing}>{t("update.later")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={installing}
            onClick={(e) => {
              // Keep the dialog open to show the progress
              e.preventDefault();
              void updater.install();
            }}
          >
            {t("update.install")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
