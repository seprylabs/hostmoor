import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Workflow,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useProjectCi } from "@/hooks/use-ci-overview";
import { ciRuns, openExternal, setCiToken } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { CiRepo, CiResult, CiRun, CiRunStatus, Project } from "@/types";

// Label kommt beim Rendern aus ci.status.<status>
const statusStyle: Record<CiRunStatus, { icon: typeof Workflow; className: string }> = {
  queued: { icon: CircleDashed, className: "text-muted-foreground" },
  running: { icon: Loader2, className: "text-info animate-spin" },
  success: { icon: CircleCheck, className: "text-success" },
  failed: { icon: CircleAlert, className: "text-danger" },
  cancelled: { icon: Ban, className: "text-muted-foreground" },
  skipped: { icon: CircleDot, className: "text-muted-foreground" },
  manual: { icon: CirclePause, className: "text-warning" },
  other: { icon: CircleDot, className: "text-muted-foreground" },
};

const forgeLabel = { github: "GitHub", gitlab: "GitLab" } as const;

export function CiPanel({ project, onEditProject }: { project: Project; onEditProject: () => void }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<CiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [tokenFor, setTokenFor] = useState<CiRepo | null>(null);

  const load = useCallback(async () => {
    if (!project.repoUrl) {
      setResult({ kind: "noRepo" });
      return;
    }
    setLoading(true);
    try {
      setResult(await ciRuns(project.id));
    } catch (e) {
      toast.error(t("ci.panel.loadFailed"), { description: String(e) });
    } finally {
      setLoading(false);
    }
  }, [project.id, project.repoUrl, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Die Hintergrund-Abfrage meldet Änderungen; dann die Liste hier nachladen
  const watched = useProjectCi(project.id);
  const watchedKey = watched && `${watched.active.map((r) => `${r.id}:${r.status}`).join()}|${watched.latestAt}`;
  const firstKey = useRef(watchedKey);
  useEffect(() => {
    if (watchedKey === firstKey.current) return;
    firstKey.current = watchedKey;
    load();
  }, [watchedKey, load]);

  const repo = result && result.kind !== "noRepo" ? result.repo : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Workflow className="text-muted-foreground size-4" />
        <CardTitle>{repo ? `${forgeLabel[repo.forge]} ${repo.forge === "github" ? "Actions" : "Pipelines"}` : "CI / Pipelines"}</CardTitle>
        <div className="ml-auto flex gap-1">
          {result?.kind === "ok" && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setTokenFor(result.repo)}
              title={result.hasToken ? t("ci.panel.changeOrRemoveToken") : t("ci.panel.addToken")}
              aria-label={t("ci.panel.manageToken")}
            >
              <KeyRound />
            </Button>
          )}
          {result?.kind !== "noRepo" && (
            <Button size="icon-sm" variant="ghost" onClick={load} disabled={loading} title={t("common.refresh")} aria-label={t("common.refresh")}>
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {repo && (
          <button
            onClick={() => openExternal(repo.webUrl)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 font-mono text-xs"
          >
            {repo.host}/{repo.path} <ExternalLink className="size-3" />
          </button>
        )}

        {!result && loading && <p className="text-muted-foreground">{t("common.loading")}</p>}

        {result?.kind === "noRepo" && (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              {project.repoUrl
                ? t("ci.panel.repoUrlNotRecognized", { url: project.repoUrl })
                : t("ci.panel.noRepoUrl")}
            </p>
            <Button size="sm" variant="outline" onClick={onEditProject}>
              {t("common.editProject")}
            </Button>
          </div>
        )}

        {result?.kind === "needsToken" && (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              {result.hasToken
                ? t("ci.panel.tokenRejected", { host: result.repo.host })
                : t("ci.panel.tokenMissing", { host: result.repo.host })}
            </p>
            <Button size="sm" variant="outline" onClick={() => setTokenFor(result.repo)}>
              <KeyRound /> {result.hasToken ? t("ci.panel.changeToken") : t("ci.panel.addToken")}
            </Button>
          </div>
        )}

        {result?.kind === "error" && <p className="text-danger">{result.message}</p>}

        {result?.kind === "ok" &&
          (result.runs.length === 0 ? (
            <p className="text-muted-foreground">{t("ci.panel.noRuns")}</p>
          ) : (
            <RunList runs={result.runs} />
          ))}
      </CardContent>

      <TokenDialog
        repo={tokenFor}
        hasToken={result?.kind === "ok" || result?.kind === "needsToken" ? result.hasToken : false}
        onClose={() => setTokenFor(null)}
        onSaved={() => {
          setTokenFor(null);
          load();
        }}
      />
    </Card>
  );
}

/** Standardmäßig nur der neueste Lauf je Workflow, aufklappbar zur ganzen Liste */
function RunList({ runs }: { runs: CiRun[] }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  // Neueste zuerst, also gewinnt der erste Lauf je Workflow; GitLab hat keine Workflows und zeigt so die letzte Pipeline
  const latest = runs.filter((run, i) => runs.findIndex((r) => r.workflow === run.workflow) === i);
  const hidden = runs.length - latest.length;

  return (
    <div className="-mx-2">
      {showAll ? runs.map((run) => <RunRow key={run.id} run={run} />) : latest.map((run) => <RunRow key={run.id} run={run} grouped />)}
      {hidden > 0 && (
        <Button size="xs" variant="ghost" className="text-muted-foreground mt-1" onClick={() => setShowAll(!showAll)}>
          {showAll ? t("ci.runList.latestOnly") : t("ci.runList.showAll", { count: runs.length })}
        </Button>
      )}
    </div>
  );
}

function RunRow({ run, grouped }: { run: CiRun; grouped?: boolean }) {
  const { t } = useTranslation();
  const style = statusStyle[run.status];
  // Gruppiert steht der Workflow oben und der Commit-Titel in der Zeile darunter
  const heading = grouped && run.workflow ? run.workflow : run.title;
  const details = grouped && run.workflow ? [run.branch, run.title] : [run.branch, run.sha && <span key="sha" className="font-mono">{run.sha}</span>, run.event, run.actor];
  return (
    <button
      onClick={() => openExternal(run.url)}
      className="hover:bg-muted/50 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left"
      title={t("ci.runRow.title", { status: t(`ci.status.${run.status}`), date: formatDateTime(run.createdAt) })}
    >
      <style.icon className={cn("mt-0.5 size-4 shrink-0", style.className)} />
      <div className="min-w-0 flex-1">
        <p className="truncate">{heading}</p>
        <p className="text-muted-foreground truncate text-xs">
          {details
            .filter(Boolean)
            .flatMap((part, i) => (i === 0 ? [part] : [" · ", part]))}
        </p>
      </div>
      <span className="text-muted-foreground shrink-0 text-xs">{formatRelative(run.createdAt)}</span>
    </button>
  );
}

function tokenHelp(repo: CiRepo, t: TFunction) {
  return repo.forge === "github"
    ? {
        url: "https://github.com/settings/personal-access-tokens/new",
        text: t("ci.token.helpGithub"),
      }
    : {
        url: `https://${repo.host}/-/user_settings/personal_access_tokens`,
        text: t("ci.token.helpGitlab", { host: repo.host }),
      };
}

function TokenDialog({
  repo,
  hasToken,
  onClose,
  onSaved,
}: {
  repo: CiRepo | null;
  hasToken: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (token: string | null) => {
    if (!repo) return;
    setSaving(true);
    try {
      await setCiToken(repo.host, token);
      toast.success(token ? t("ci.token.saved") : t("ci.token.removed"));
      setValue("");
      onSaved();
    } catch (e) {
      toast.error(t("common.saveFailed"), { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const help = repo && tokenHelp(repo, t);

  return (
    <Dialog
      open={repo !== null}
      onOpenChange={(open) => {
        if (!open) {
          setValue("");
          onClose();
        }
      }}
    >
      {repo && help && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ci.token.title", { host: repo.host })}</DialogTitle>
            <DialogDescription>{t("ci.token.description", { host: repo.host, store: t(`ci.token.store.${platform}`) })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{help.text}</p>
            <Button size="sm" variant="outline" onClick={() => openExternal(help.url)}>
              {t("ci.token.openTokenPage")} <ExternalLink />
            </Button>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={hasToken ? t("ci.token.placeholderReplace") : t("ci.token.placeholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && value.trim() && save(value)}
            />
          </div>
          <DialogFooter>
            {hasToken && (
              <Button variant="ghost" className="text-danger sm:mr-auto" onClick={() => save(null)} disabled={saving}>
                {t("ci.token.remove")}
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => save(value)} disabled={saving || !value.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
