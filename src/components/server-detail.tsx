import { useState } from "react";
import { Clock, KeyRound, Loader2, Plus, RefreshCw, Server as ServerIcon, Terminal } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FactRow, NotesCard, UsageBar } from "@/components/fact";
import { ConnectionPanel } from "@/components/connection-panel";
import { DetailActions } from "@/components/detail-actions";
import { TerminalButton } from "@/components/terminal-button";
import { HealthDot } from "@/components/health-dot";
import { testConnection } from "@/lib/api";
import {
  ageInDays,
  formatDateTime,
  formatRelative,
  formatUptime,
  providerLabel,
  serverHealth,
  sshTarget,
  STALE_AFTER_DAYS,
  stackLabel,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConnectionResult, Customer, Project, Selection, Server } from "@/types";

interface Props {
  server: Server;
  customer?: Customer;
  projects: Project[];
  onSelect: (selection: Selection) => void;
  /** Startet den Server-Check; liefert bei Verbindungsproblemen die Ursache */
  onCheck: () => Promise<ConnectionResult | null>;
  onEdit: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onAddProject: () => void;
}

export function ServerDetail({ server, customer, projects, onSelect, onCheck, onEdit, onToggleFavorite, onDelete, onAddProject }: Props) {
  const facts = server.facts;
  const stale = facts ? ageInDays(facts.checkedAt) > STALE_AFTER_DAYS : false;

  // Ergebnis gilt nur für die aktuellen Zugangsdaten; nach dem Bearbeiten verfällt es
  const connectionKey = `${server.host}|${server.port}|${server.sshUser}|${server.sshKeyPath}`;
  const [connection, setConnection] = useState<{ key: string; result: ConnectionResult | null }>({
    key: connectionKey,
    result: null,
  });
  const connectionResult = connection.key === connectionKey ? connection.result : null;
  const [busy, setBusy] = useState<"test" | "check" | null>(null);

  const runTest = async () => {
    setBusy("test");
    try {
      setConnection({ key: connectionKey, result: await testConnection(server.id) });
    } catch (e) {
      toast.error("Test nicht möglich", { description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const runCheck = async () => {
    setBusy("check");
    try {
      // Bei Erfolg altes Fehlerergebnis ausblenden, sonst Hilfe anzeigen
      setConnection({ key: connectionKey, result: await onCheck() });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ServerIcon className="text-muted-foreground size-5" />
            <h1 className="text-[22px] font-semibold tracking-tight">{server.name}</h1>
            <HealthDot health={serverHealth(facts)} />
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{providerLabel[server.provider]}</Badge>
            {customer ? (
              <button className="hover:text-foreground underline-offset-2 hover:underline" onClick={() => onSelect({ kind: "customer", id: customer.id })}>
                Kunde: {customer.name}
              </button>
            ) : (
              <span>Eigener Server</span>
            )}
            <span className="flex items-center gap-1 font-mono">
              <Terminal className="size-3.5" /> {sshTarget(server)}
            </span>
            {server.sshKeyPath && (
              <span className="flex items-center gap-1 font-mono">
                <KeyRound className="size-3.5" /> {server.sshKeyPath}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <TerminalButton serverId={server.id} />
            <Button size="sm" onClick={runCheck} disabled={busy !== null}>
              {busy === "check" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {busy === "check" ? "Prüfe …" : "Jetzt prüfen"}
            </Button>
            <DetailActions favorite={server.favorite} onToggleFavorite={onToggleFavorite} onEdit={onEdit} onDelete={onDelete} />
          </div>
          {facts ? (
            <span
              className={cn("flex items-center gap-1 text-xs", stale ? "text-warning" : "text-muted-foreground")}
              title={`Geprüft am ${formatDateTime(facts.checkedAt)}`}
            >
              {stale && <Clock className="size-3" />}
              Stand: {formatRelative(facts.checkedAt)}
              {stale && " · evtl. veraltet"}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">Noch nie geprüft</span>
          )}
        </div>
      </header>

      <ConnectionPanel
        server={server}
        result={connectionResult}
        running={busy === "test"}
        disabled={busy !== null}
        onTest={runTest}
      />

      {!facts ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Für diesen Server liegen noch keine Daten vor. Mit „Jetzt prüfen“ liest StackPort PHP, Node,
            Kapazität usw. aus. Auf dem Server wird dabei nichts verändert.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Kapazität</CardTitle>
            </CardHeader>
            <CardContent>
              <FactRow
                label="CPU"
                value={`${facts.cpu.cores} Kerne · Last ${facts.cpu.load.map((l) => l.toFixed(2)).join(" / ")}`}
              />
              <UsageBar
                label="RAM"
                used={Math.round(facts.memory.usedMb / 1024 * 10) / 10}
                total={Math.round(facts.memory.totalMb / 1024 * 10) / 10}
                unit="GB"
              />
              {facts.disks.map((disk) => (
                <UsageBar
                  key={disk.mount}
                  label={`Speicher ${disk.mount}`}
                  used={disk.usedGb}
                  total={disk.totalGb}
                  unit="GB"
                />
              ))}
              <FactRow label="Laufzeit" value={formatUptime(facts.uptimeSeconds)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System &amp; Dienste</CardTitle>
            </CardHeader>
            <CardContent>
              <FactRow label="Betriebssystem" value={`${facts.os.name} ${facts.os.version}`} />
              <FactRow label="Kernel" value={facts.os.kernel} />
              <FactRow
                label="Webserver"
                value={facts.webserver && `${facts.webserver.name} ${facts.webserver.version}`}
              />
              <FactRow
                label="Datenbank"
                value={facts.database && `${facts.database.name} ${facts.database.version}`}
              />
              <FactRow label="Redis" value={facts.redis} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>PHP</CardTitle>
            </CardHeader>
            <CardContent>
              <FactRow label="CLI-Version" value={facts.php?.version} />
              {facts.php && (
                <>
                  <FactRow label="Installiert" value={facts.php.installed.join(", ")} />
                  <FactRow label="memory_limit (CLI)" value={facts.php.memoryLimit} />
                  <FactRow label="upload_max_filesize (CLI)" value={facts.php.uploadMaxFilesize} />
                  <div className="flex flex-wrap gap-1 pt-2">
                    {facts.php.extensions.map((ext) => (
                      <Badge key={ext} variant="outline" className="font-mono">
                        {ext}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Entwickler-Tools</CardTitle>
            </CardHeader>
            <CardContent>
              <FactRow label="Composer" value={facts.composer} />
              <FactRow label="Node.js" value={facts.node} />
              <FactRow label="npm" value={facts.npm} />
              <FactRow label="Git" value={facts.git} />
              <FactRow label="WP-CLI" value={facts.wpCli} />
            </CardContent>
          </Card>
        </div>
      )}

      {server.notes && <NotesCard notes={server.notes} />}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Projekte auf diesem Server</CardTitle>
          <Button variant="ghost" size="sm" onClick={onAddProject}>
            <Plus /> Projekt
          </Button>
        </CardHeader>
        <CardContent className="divide-y">
          {projects.length === 0 && (
            <p className="text-muted-foreground text-sm">Noch keine Projekte zugeordnet.</p>
          )}
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => onSelect({ kind: "project", id: project.id })}
              className="hover:bg-muted/50 -mx-2 flex w-[calc(100%+1rem)] items-center justify-between rounded-md px-2 py-2 text-left text-sm"
            >
              <span>
                {project.name}
                {project.domain && <span className="text-muted-foreground"> · {project.domain}</span>}
              </span>
              <Badge variant="secondary">{stackLabel[project.stack]}</Badge>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
