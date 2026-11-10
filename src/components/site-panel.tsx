import { useState } from "react";
import { CircleAlert, CircleCheck, CircleDashed, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FactRow } from "@/components/fact";
import { daysLeft, useSiteStatus } from "@/hooks/use-site-status";
import { checkSite } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Project, SiteLevel, SiteStatus } from "@/types";

const levelStyle: Record<SiteLevel, { icon: typeof CircleCheck; className: string }> = {
  ok: { icon: CircleCheck, className: "text-success" },
  warn: { icon: TriangleAlert, className: "text-warning" },
  critical: { icon: CircleAlert, className: "text-danger" },
  unknown: { icon: CircleDashed, className: "text-muted-foreground" },
};

function dateOf(unixSeconds: number): string {
  return formatDateTime(new Date(unixSeconds * 1000).toISOString());
}

function CertificateLine({ status }: { status: SiteStatus }) {
  const { t } = useTranslation();
  const cert = status.certificate;
  if (!cert) return <span className="text-muted-foreground">{t("site.unreachable", { error: status.error ?? "–" })}</span>;
  if (cert.problem) {
    return <span>{t(`site.problem.${cert.problem}`, { date: dateOf(cert.expiresAt) })}</span>;
  }
  const days = daysLeft(cert.expiresAt);
  return (
    <span>
      {t("site.validUntil", { date: dateOf(cert.expiresAt) })} ·{" "}
      {days <= 0 ? t("site.expiresToday") : t("site.expiresIn", { count: days })}
    </span>
  );
}

export function SitePanel({ project, onEditProject }: { project: Project; onEditProject: () => void }) {
  const { t } = useTranslation();
  const status = useSiteStatus(project.id);
  const [loading, setLoading] = useState(false);
  // Results for an old domain stay in the overview until the next background round
  const current = status && status.domain === project.domain ? status : undefined;

  async function check() {
    setLoading(true);
    try {
      await checkSite(project.id);
    } catch (e) {
      toast.error(t("site.checkFailed"), { description: String(e) });
    } finally {
      setLoading(false);
    }
  }

  const style = current ? levelStyle[current.level] : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <ShieldCheck className="text-muted-foreground size-4" />
        <CardTitle>{t("site.title")}</CardTitle>
        {project.domain && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            onClick={check}
            disabled={loading}
            title={t("site.checkNow")}
            aria-label={t("site.checkNow")}
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {!project.domain ? (
          <div className="space-y-3">
            <p className="text-muted-foreground">{t("site.noDomain")}</p>
            <Button size="sm" variant="outline" onClick={onEditProject}>
              {t("site.addDomain")}
            </Button>
          </div>
        ) : !current ? (
          <p className="text-muted-foreground">{loading ? t("common.loading") : t("site.notChecked")}</p>
        ) : (
          <>
            <div className={cn("flex items-start gap-2 pb-2", style?.className)}>
              {style && <style.icon className="mt-0.5 size-4 shrink-0" />}
              <CertificateLine status={current} />
            </div>
            <FactRow label={t("site.domain")} value={current.domain} />
            {current.certificate && <FactRow label={t("site.issuer")} value={current.certificate.issuer} />}
            <FactRow label={t("site.http")} value={current.http && `${current.http.status} · ${current.http.millis} ms`} />
            <FactRow label={t("site.checked")} value={formatRelative(new Date(current.checkedAt).toISOString())} />
            <p className="text-muted-foreground pt-2 text-xs">{t("site.autoCheck")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Small sidebar icon: certificate expires soon or is invalid. A valid certificate stays quiet. */
export function SiteStatusIcon({ projectId, className }: { projectId: string; className?: string }) {
  const { t } = useTranslation();
  const status = useSiteStatus(projectId);
  if (!status || (status.level !== "warn" && status.level !== "critical")) return null;
  const title =
    status.level === "warn" && status.certificate
      ? t("site.icon.warn", { count: daysLeft(status.certificate.expiresAt) })
      : t("site.icon.critical", { domain: status.domain });
  return (
    <span title={title} className={cn("shrink-0", className)}>
      <ShieldCheck className={cn("size-3.5", status.level === "warn" ? "text-warning" : "text-danger")} />
    </span>
  );
}
