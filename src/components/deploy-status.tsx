import { CircleAlert, CircleX, Loader2, Workflow } from "lucide-react";

import { useProjectCi } from "@/hooks/use-ci-overview";
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

/** Kleines Symbol in der Seitenleiste: Pipeline läuft oder letzte fehlgeschlagen */
export function CiStatusIcon({ projectId, className }: { projectId: string; className?: string }) {
  const ci = useProjectCi(projectId);
  if (!ci) return null;

  if (ci.active.length > 0) {
    return (
      <span title={`CI läuft: ${ci.active[0].title}`} className={cn("shrink-0", className)}>
        <Workflow className="size-3.5 animate-pulse text-violet-500" />
      </span>
    );
  }
  if (ci.latest === "failed") {
    const when = ci.latestAt ? ` · ${formatRelative(ci.latestAt)}` : "";
    return (
      <span title={`Letzte Pipeline fehlgeschlagen${when}`} className={cn("shrink-0", className)}>
        <CircleX className="size-3.5 text-red-500" />
      </span>
    );
  }
  return null;
}

/** Deploy- und CI-Status nebeneinander */
export function ProjectStatusIcons({ projectId, className }: { projectId: string; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)}>
      <CiStatusIcon projectId={projectId} />
      <DeployStatusIcon projectId={projectId} />
    </span>
  );
}
