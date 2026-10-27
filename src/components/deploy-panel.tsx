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

const statusStyle: Record<DeployStatus, { icon: typeof Rocket; label: string; className: string }> = {
  running: { icon: Loader2, label: "Läuft", className: "text-info animate-spin" },
  success: { icon: CircleCheck, label: "Erfolgreich", className: "text-success" },
  failed: { icon: CircleAlert, label: "Fehlgeschlagen", className: "text-danger" },
  cancelled: { icon: Ban, label: "Abgebrochen", className: "text-muted-foreground" },
  interrupted: { icon: CircleSlash, label: "Unterbrochen (App beendet)", className: "text-warning" },
};

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
  const script = project.deployScript ?? "";
  const live = useLiveDeploy(project.id);
  const running = live?.status === "running";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(script);
  const [confirming, setConfirming] = useState(false);
  const [history, setHistory] = useState<Deploy[]>([]);

  const reloadHistory = useCallback(async () => {
    try {
      setHistory(await listDeploys(project.id));
    } catch (e) {
      toast.error("Deploy-Verlauf konnte nicht geladen werden", { description: String(e) });
    }
  }, [project.id]);

  useEffect(() => {
    reloadHistory();
  }, [reloadHistory]);

  // Nach dem Ende eines Deploys den Verlauf aktualisieren
  useEffect(() => {
    if (live && live.status !== "running") reloadHistory();
  }, [live?.status, reloadHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = !server
    ? "Ordne dem Projekt zuerst einen Server zu."
    : !project.path
      ? "Trag beim Projekt den Pfad auf dem Server ein (z. B. /var/www/shop), dort läuft das Skript."
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
      toast.error("Deploy konnte nicht gestartet werden", { description: String(e) });
    }
  };

  const cancel = async () => {
    try {
      await cancelDeploy(project.id);
    } catch (e) {
      toast.error("Abbrechen fehlgeschlagen", { description: String(e) });
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
              <Pencil /> Skript bearbeiten
            </Button>
          )}
          {running ? (
            <Button size="sm" variant="outline" onClick={cancel}>
              <Square /> Abbrechen
            </Button>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)} disabled={!script || !!missing || editing}>
              <Rocket /> Deployen
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {missing && (
          <div className="bg-muted/60 flex items-center justify-between gap-4 rounded-md px-3 py-2">
            <span className="text-muted-foreground">{missing}</span>
            <Button size="sm" variant="outline" onClick={onEditProject}>
              Projekt bearbeiten
            </Button>
          </div>
        )}

        {editing ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">Vorlage:</span>
              {Object.values(deployTemplates)
                .flat()
                .map((t) => (
                  <Button key={t.label} size="xs" variant="outline" onClick={() => setDraft(t.script)}>
                    {t.label}
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
              Läuft mit bash im Ordner <code className="font-mono">{project.path || "(kein Pfad)"}</code> auf dem Server.
              Jeder Befehl wird angezeigt, beim ersten Fehler bricht der Deploy ab. Zeilen mit # sind Kommentare.
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Verwerfen
              </Button>
              <Button size="sm" onClick={save}>
                Speichern
              </Button>
            </div>
          </div>
        ) : !script ? (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              Noch kein Deploy-Skript. Leg fest, welche Befehle beim Deployen auf dem Server laufen sollen, zum
              Beispiel <code className="font-mono">git pull</code> und <code className="font-mono">composer install</code>.
            </p>
            <Button size="sm" variant="outline" onClick={startEditing}>
              <Pencil /> Skript anlegen
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
            <p className="text-muted-foreground pb-1 text-xs font-medium">Verlauf</p>
            {history.map((d) => (
              <HistoryRow key={d.id} deploy={d} />
            ))}
          </div>
        )}
      </CardContent>

      {server && (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>„{project.name}“ jetzt deployen?</AlertDialogTitle>
              <AlertDialogDescription>
                Auf <strong>{server.name}</strong> ({sshTarget(server)}) im Ordner{" "}
                <code className="font-mono">{project.path}</code> werden diese Befehle ausgeführt:
              </AlertDialogDescription>
            </AlertDialogHeader>
            <pre className="bg-muted max-h-56 overflow-auto rounded-md p-3 font-mono text-xs">{script}</pre>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction onClick={deploy}>
                <Rocket /> Deployen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}

function LiveOutput({ lines, status }: { lines: string[]; status: DeployStatus }) {
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
        {status === "running" ? "Deploy läuft …" : style.label}
      </p>
      <pre
        ref={ref}
        className="h-72 overflow-auto rounded-md bg-terminal p-3 font-mono text-xs leading-relaxed text-terminal-foreground"
      >
        {lines.length === 0 ? "Verbinde …" : lines.join("\n")}
      </pre>
    </div>
  );
}

function HistoryRow({ deploy }: { deploy: Deploy }) {
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
        <span>{style.label}</span>
        <span className="text-muted-foreground">· {formatRelative(deploy.startedAt)}</span>
        <span className="text-muted-foreground ml-auto text-xs">
          {deploy.serverName}
          {deploy.durationMs != null && ` · ${formatDuration(deploy.durationMs)}`}
        </span>
      </button>
      {open && (
        <pre className="mt-1 mb-2 max-h-72 overflow-auto rounded-md bg-terminal p-3 font-mono text-xs leading-relaxed text-terminal-foreground">
          {deploy.output || "Keine Ausgabe gespeichert."}
        </pre>
      )}
    </div>
  );
}
