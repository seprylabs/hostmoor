import { CircleAlert, Loader2 } from "lucide-react";

import { useDeployStatus } from "@/hooks/use-live-deploys";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Kleines Symbol in der Seitenleiste: Deploy läuft oder letzter Deploy fehlgeschlagen. Erfolg bleibt unauffällig. */
export function DeployStatusIcon({ projectId, className }: { projectId: string; className?: string }) {
  const deploy = useDeployStatus(projectId);
  if (!deploy) return null;

  if (deploy.status === "running") {
    return (
      <span title="Deploy läuft" className={cn("shrink-0", className)}>
        <Loader2 className="size-3.5 animate-spin text-sky-500" />
      </span>
    );
  }
  if (deploy.status === "failed" || deploy.status === "interrupted") {
    const when = deploy.startedAt ? ` · ${formatRelative(deploy.startedAt)}` : "";
    const label = deploy.status === "failed" ? "Letzter Deploy fehlgeschlagen" : "Letzter Deploy unterbrochen";
    return (
      <span title={`${label}${when}`} className={cn("shrink-0", className)}>
        <CircleAlert className={cn("size-3.5", deploy.status === "failed" ? "text-red-500" : "text-amber-500")} />
      </span>
    );
  }
  return null;
}
