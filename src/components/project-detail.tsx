import { ExternalLink, GitBranch, Globe } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CiPanel } from "@/components/ci-panel";
import { DeployPanel } from "@/components/deploy-panel";
import { DetailActions } from "@/components/detail-actions";
import { TerminalButton } from "@/components/terminal-button";
import { FactRow, NotesCard } from "@/components/fact";
import { HealthDot } from "@/components/health-dot";
import { providerLabel, serverHealth, sshTarget, stackLabel } from "@/lib/format";
import type { Customer, Project, Selection, Server } from "@/types";

interface Props {
  project: Project;
  customer?: Customer;
  server?: Server;
  onSelect: (selection: Selection) => void;
  onEdit: () => void;
  onSaveDeployScript: (script: string | null) => Promise<boolean>;
  onToggleFavorite: () => void;
  onDelete: () => void;
}

export function ProjectDetail({
  project,
  customer,
  server,
  onSelect,
  onEdit,
  onSaveDeployScript,
  onToggleFavorite,
  onDelete,
}: Props) {
  const facts = server?.facts;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Globe className="text-muted-foreground size-5" />
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <Badge variant="secondary">{stackLabel[project.stack]}</Badge>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {customer && (
              <button
                className="hover:text-foreground underline-offset-2 hover:underline"
                onClick={() => onSelect({ kind: "customer", id: customer.id })}
              >
                Kunde: {customer.name}
              </button>
            )}
            {project.domain && <span className="font-mono">{project.domain}</span>}
            {project.path && <span className="font-mono">{project.path}</span>}
            {project.repoUrl && (
              <span className="flex items-center gap-1 font-mono">
                <GitBranch className="size-3.5" /> {project.repoUrl}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {server && <TerminalButton serverId={server.id} dir={project.path} />}
          <DetailActions favorite={project.favorite} onToggleFavorite={onToggleFavorite} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Server</CardTitle>
            {server && (
              <Button variant="ghost" size="sm" onClick={() => onSelect({ kind: "server", id: server.id })}>
                Details <ExternalLink />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {server ? (
              <>
                <FactRow
                  label="Name"
                  value={
                    <span className="flex items-center gap-2">
                      <HealthDot health={serverHealth(facts)} /> {server.name}
                    </span>
                  }
                />
                <FactRow label="Anbieter" value={providerLabel[server.provider]} />
                <FactRow label="SSH" value={sshTarget(server)} />
                {facts ? (
                  <>
                    <FactRow label="PHP" value={facts.php?.version} />
                    {project.stack === "laravel" && (
                      <>
                        <FactRow label="Composer" value={facts.composer} />
                        <FactRow label="Node.js / npm" value={facts.node && `${facts.node} / ${facts.npm ?? "–"}`} />
                      </>
                    )}
                    {project.stack === "wordpress" && <FactRow label="WP-CLI" value={facts.wpCli} />}
                    <FactRow
                      label="Datenbank"
                      value={facts.database && `${facts.database.name} ${facts.database.version}`}
                    />
                  </>
                ) : (
                  <p className="text-muted-foreground pt-2 text-sm">Server wurde noch nicht geprüft.</p>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">Diesem Projekt ist noch kein Server zugeordnet.</p>
                <Button variant="outline" size="sm" onClick={onEdit}>
                  Server zuordnen
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <CiPanel project={project} onEditProject={onEdit} />
      </div>

      <DeployPanel project={project} server={server} onEditProject={onEdit} onSaveScript={onSaveDeployScript} />

      {project.notes && <NotesCard notes={project.notes} />}
    </div>
  );
}
