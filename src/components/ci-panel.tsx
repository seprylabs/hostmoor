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
import { cn } from "@/lib/utils";
import type { CiRepo, CiResult, CiRun, CiRunStatus, Project } from "@/types";

const statusStyle: Record<CiRunStatus, { icon: typeof Workflow; label: string; className: string }> = {
  queued: { icon: CircleDashed, label: "Wartet", className: "text-muted-foreground" },
  running: { icon: Loader2, label: "Läuft", className: "text-sky-500 animate-spin" },
  success: { icon: CircleCheck, label: "Erfolgreich", className: "text-emerald-500" },
  failed: { icon: CircleAlert, label: "Fehlgeschlagen", className: "text-red-500" },
  cancelled: { icon: Ban, label: "Abgebrochen", className: "text-muted-foreground" },
  skipped: { icon: CircleDot, label: "Übersprungen", className: "text-muted-foreground" },
  manual: { icon: CirclePause, label: "Wartet auf Freigabe", className: "text-amber-500" },
  other: { icon: CircleDot, label: "Unbekannt", className: "text-muted-foreground" },
};

const forgeLabel = { github: "GitHub", gitlab: "GitLab" } as const;

export function CiPanel({ project, onEditProject }: { project: Project; onEditProject: () => void }) {
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
      toast.error("Pipelines konnten nicht geladen werden", { description: String(e) });
    } finally {
      setLoading(false);
    }
  }, [project.id, project.repoUrl]);

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
              title={result.hasToken ? "Token ändern oder entfernen" : "Token hinterlegen"}
              aria-label="Token verwalten"
            >
              <KeyRound />
            </Button>
          )}
          {result?.kind !== "noRepo" && (
            <Button size="icon-sm" variant="ghost" onClick={load} disabled={loading} title="Aktualisieren" aria-label="Aktualisieren">
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

        {!result && loading && <p className="text-muted-foreground">Lade …</p>}

        {result?.kind === "noRepo" && (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              {project.repoUrl
                ? `Die Repo-URL „${project.repoUrl}“ wurde nicht erkannt. Erwartet wird z. B. git@github.com:firma/projekt.git oder https://gitlab.com/gruppe/projekt.`
                : "Trag beim Projekt die Repo-URL ein, dann erscheinen hier die letzten Läufe."}
            </p>
            <Button size="sm" variant="outline" onClick={onEditProject}>
              Projekt bearbeiten
            </Button>
          </div>
        )}

        {result?.kind === "needsToken" && (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              {result.hasToken
                ? `Der hinterlegte Token für ${result.repo.host} wird abgelehnt oder hat keinen Zugriff auf dieses Repo.`
                : `Das Repo ist privat oder nicht erreichbar. Hinterlege einen Token für ${result.repo.host}, damit StackPort die Läufe lesen darf.`}
            </p>
            <Button size="sm" variant="outline" onClick={() => setTokenFor(result.repo)}>
              <KeyRound /> {result.hasToken ? "Token ändern" : "Token hinterlegen"}
            </Button>
          </div>
        )}

        {result?.kind === "error" && <p className="text-red-500">{result.message}</p>}

        {result?.kind === "ok" &&
          (result.runs.length === 0 ? (
            <p className="text-muted-foreground">Noch keine Läufe.</p>
          ) : (
            <div className="-mx-2">
              {result.runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
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

function RunRow({ run }: { run: CiRun }) {
  const style = statusStyle[run.status];
  return (
    <button
      onClick={() => openExternal(run.url)}
      className="hover:bg-muted/50 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left"
      title={`${style.label} · ${formatDateTime(run.createdAt)} · im Browser öffnen`}
    >
      <style.icon className={cn("mt-0.5 size-4 shrink-0", style.className)} />
      <div className="min-w-0 flex-1">
        <p className="truncate">{run.title}</p>
        <p className="text-muted-foreground truncate text-xs">
          {[run.branch, run.sha && <span key="sha" className="font-mono">{run.sha}</span>, run.event, run.actor]
            .filter(Boolean)
            .flatMap((part, i) => (i === 0 ? [part] : [" · ", part]))}
        </p>
      </div>
      <span className="text-muted-foreground shrink-0 text-xs">{formatRelative(run.createdAt)}</span>
    </button>
  );
}

function tokenHelp(repo: CiRepo) {
  return repo.forge === "github"
    ? {
        url: "https://github.com/settings/personal-access-tokens/new",
        text: "Empfohlen: ein „Fine-grained token“ mit „Actions: Read-only“ für die gewünschten Repos. Gehört das Repo einer Organisation, muss sie als Resource owner gewählt sein, und der Token darf nicht auf Freigabe warten („Pending“). Alternativ geht ein „Token (classic)“ mit dem Scope repo, der darf aber deutlich mehr.",
      }
    : {
        url: `https://${repo.host}/-/user_settings/personal_access_tokens`,
        text: `Auf ${repo.host} einen „Personal access token“ mit dem Scope read_api anlegen. Mehr braucht StackPort nicht.`,
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
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (token: string | null) => {
    if (!repo) return;
    setSaving(true);
    try {
      await setCiToken(repo.host, token);
      toast.success(token ? "Token im Schlüsselbund gespeichert" : "Token entfernt");
      setValue("");
      onSaved();
    } catch (e) {
      toast.error("Speichern fehlgeschlagen", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const help = repo && tokenHelp(repo);

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
            <DialogTitle>Token für {repo.host}</DialogTitle>
            <DialogDescription>
              Der Token wird im macOS-Schlüsselbund gespeichert, nicht in der StackPort-Datenbank und nicht im Backup. Er
              gilt für alle Projekte auf {repo.host}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{help.text}</p>
            <Button size="sm" variant="outline" onClick={() => openExternal(help.url)}>
              Token-Seite öffnen <ExternalLink />
            </Button>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={hasToken ? "Neuen Token einfügen, um den alten zu ersetzen" : "Token einfügen"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && value.trim() && save(value)}
            />
          </div>
          <DialogFooter>
            {hasToken && (
              <Button variant="ghost" className="text-red-500 sm:mr-auto" onClick={() => save(null)} disabled={saving}>
                Token entfernen
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button onClick={() => save(value)} disabled={saving || !value.trim()}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
