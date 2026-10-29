import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Loader2,
  Pencil,
  Rocket,
  Square,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { beginLiveDeploy, discardLiveDeploy, useLiveDeploy } from "@/hooks/use-live-deploys";
import { cancelDeploy, listDeploys, startDeploy } from "@/lib/api";
import { deployTemplates } from "@/lib/deploy-templates";
import { formatDateTime, formatRelative, sshTarget } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Deploy, DeployStatus, Project, Server } from "@/types";

// Label kommt beim Rendern aus deploy.status.<status>
const statusStyle: Record<DeployStatus, { icon: typeof Rocket; className: string }> = {
  running: { icon: Loader2, className: "text-info animate-spin" },
  success: { icon: CircleCheck, className: "text-success" },
  failed: { icon: CircleAlert, className: "text-danger" },
  cancelled: { icon: Ban, className: "text-muted-foreground" },
  interrupted: { icon: CircleSlash, className: "text-warning" },
};

/** So viele Deploys zeigt der Verlauf, bevor er aufgeklappt wird */
const HISTORY_PREVIEW = 5;

function formatDuration(ms?: number | null) {
  if (ms == null) return "";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

interface Props {
  project: Project;
  server?: Server;
  onEditProject: () => void;
  onSaveScript: (script: string | null) => Promise<boolean>;
}

export function DeployPanel({ project, server, onEditProject, onSaveScript }: Props) {
  const { t } = useTranslation();
  const script = project.deployScript ?? "";
  const live = useLiveDeploy(project.id);
  const running = live?.status === "running";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(script);
  const [confirming, setConfirming] = useState(false);
  const [history, setHistory] = useState<Deploy[]>([]);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const reloadHistory = useCallback(async () => {
    try {
      setHistory(await listDeploys(project.id));
    } catch (e) {
      toast.error(t("deploy.panel.historyLoadFailed"), { description: String(e) });
    }
  }, [project.id, t]);

  useEffect(() => {
    reloadHistory();
  }, [reloadHistory]);

  // Nach dem Ende eines Deploys den Verlauf aktualisieren
  useEffect(() => {
    if (live && live.status !== "running") reloadHistory();
  }, [live?.status, reloadHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = !server
    ? t("deploy.panel.missingServer")
    : !project.path
      ? t("deploy.panel.missingPath")
      : null;

  const startEditing = () => {
    setDraft(script || (deployTemplates[project.stack][0]?.script ?? ""));
    setEditing(true);
  };

  const save = async () => {
    if (await onSaveScript(draft.trim() ? draft : null)) setEditing(false);
  };

  const deploy = async () => {
    setConfirming(false);
    const deployId = crypto.randomUUID();
    await beginLiveDeploy(project.id, deployId);
    try {
      await startDeploy(project.id, deployId);
      reloadHistory();
    } catch (e) {
      discardLiveDeploy(project.id);
      toast.error(t("deploy.panel.startFailed"), { description: String(e) });
    }
  };

  const cancel = async () => {
    try {
      await cancelDeploy(project.id);
    } catch (e) {
      toast.error(t("deploy.panel.cancelFailed"), { description: String(e) });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Rocket className="text-muted-foreground size-4" />
        <CardTitle>Deploy</CardTitle>
        <div className="ml-auto flex gap-2">
          {!editing && script && (
            <Button size="sm" variant="ghost" onClick={startEditing} disabled={running}>
              <Pencil /> {t("deploy.panel.editScript")}
            </Button>
          )}
          {running ? (
            <Button size="sm" variant="outline" onClick={cancel}>
              <Square /> {t("common.cancel")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)} disabled={!script || !!missing || editing}>
              <Rocket /> {t("deploy.panel.deploy")}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {missing && (
          <div className="bg-muted/60 flex items-center justify-between gap-4 rounded-md px-3 py-2">
            <span className="text-muted-foreground">{missing}</span>
            <Button size="sm" variant="outline" onClick={onEditProject}>
              {t("common.editProject")}
            </Button>
          </div>
        )}

        {editing ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">{t("deploy.panel.template")}</span>
              {Object.values(deployTemplates)
                .flat()
                .map((template) => (
                  <Button key={template.label} size="xs" variant="outline" onClick={() => setDraft(template.script)}>
                    {template.label}
                  </Button>
                ))}
            </div>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              rows={10}
              className="font-mono text-xs"
            />
            <p className="text-muted-foreground text-xs">
              <Trans
                i18nKey="deploy.panel.editorHelp"
                values={{ path: project.path || t("deploy.panel.noPath") }}
                components={{ code: <code className="font-mono" /> }}
              />
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t("deploy.panel.discard")}
              </Button>
              <Button size="sm" onClick={save}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        ) : !script ? (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              <Trans i18nKey="deploy.panel.noScript" components={{ code: <code className="font-mono" /> }} />
            </p>
            <Button size="sm" variant="outline" onClick={startEditing}>
              <Pencil /> {t("deploy.panel.createScript")}
            </Button>
          </div>
        ) : (
          !live && (
            <pre className="bg-muted text-muted-foreground max-h-40 overflow-auto rounded-md p-3 font-mono text-xs">
              {script}
            </pre>
          )
        )}

        {live && <LiveOutput lines={live.lines} status={live.status} />}

        {history.length > 0 && (
          <div className="space-y-1 border-t pt-3">
            <p className="text-muted-foreground pb-1 text-xs font-medium">{t("deploy.panel.history")}</p>
            {(showAllHistory ? history : history.slice(0, HISTORY_PREVIEW)).map((d) => (
              <HistoryRow key={d.id} deploy={d} />
            ))}
            {history.length > HISTORY_PREVIEW && (
              <Button size="xs" variant="ghost" className="text-muted-foreground -mx-2" onClick={() => setShowAllHistory(!showAllHistory)}>
                {showAllHistory
                  ? t("deploy.panel.showLess")
                  : t("deploy.panel.showOlder", { count: history.length - HISTORY_PREVIEW })}
              </Button>
            )}
          </div>
        )}
      </CardContent>

      {server && (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("deploy.panel.confirmTitle", { name: project.name })}</AlertDialogTitle>
              <AlertDialogDescription>
                <Trans
                  i18nKey="deploy.panel.confirmDescription"
                  values={{ server: server.name, target: sshTarget(server), path: project.path }}
                  components={{ strong: <strong />, code: <code className="font-mono" /> }}
                />
              </AlertDialogDescription>
            </AlertDialogHeader>
            <pre className="bg-muted max-h-56 overflow-auto rounded-md p-3 font-mono text-xs">{script}</pre>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={deploy}>
                <Rocket /> {t("deploy.panel.deploy")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}

function LiveOutput({ lines, status }: { lines: string[]; status: DeployStatus }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLPreElement>(null);
  const style = statusStyle[status];

  // Mitscrollen, solange man unten ist
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-medium">
        <style.icon className={cn("size-4", style.className)} />
        {status === "running" ? t("deploy.live.running") : t(`deploy.status.${status}`)}
      </p>
      <pre
        ref={ref}
        className="h-72 overflow-auto rounded-md bg-terminal p-3 font-mono text-xs leading-relaxed text-terminal-foreground"
      >
        {lines.length === 0 ? t("deploy.live.connecting") : lines.join("\n")}
      </pre>
    </div>
  );
}

function HistoryRow({ deploy }: { deploy: Deploy }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const style = statusStyle[deploy.status];

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="hover:bg-muted/50 -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left"
        title={formatDateTime(deploy.startedAt)}
      >
        <ChevronRight className={cn("text-muted-foreground size-3.5 transition-transform", open && "rotate-90")} />
        <style.icon className={cn("size-4", style.className)} />
        <span>{t(`deploy.status.${deploy.status}`)}</span>
        <span className="text-muted-foreground">· {formatRelative(deploy.startedAt)}</span>
        <span className="text-muted-foreground ml-auto text-xs">
          {deploy.serverName}
          {deploy.durationMs != null && ` · ${formatDuration(deploy.durationMs)}`}
        </span>
      </button>
      {open && (
        <pre className="mt-1 mb-2 max-h-72 overflow-auto rounded-md bg-terminal p-3 font-mono text-xs leading-relaxed text-terminal-foreground">
          {deploy.output || t("deploy.history.noOutput")}
        </pre>
      )}
    </div>
  );
}
