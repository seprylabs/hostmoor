import { Building2, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailActions } from "@/components/detail-actions";
import { NotesCard } from "@/components/fact";
import { HealthDot } from "@/components/health-dot";
import { providerLabel, serverHealth, stackLabel } from "@/lib/format";
import type { Customer, Project, Selection, Server } from "@/types";

interface Props {
  customer: Customer;
  projects: Project[];
  /** Server, die dem Kunden gehören oder auf denen seine Projekte laufen */
  servers: Server[];
  onSelect: (selection: Selection) => void;
  onEdit: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onAddProject: () => void;
  onAddServer: () => void;
}

export function CustomerDetail({ customer, projects, servers, onSelect, onEdit, onToggleFavorite, onDelete, onAddProject, onAddServer }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Building2 className="text-muted-foreground size-5" />
          <h1 className="text-[22px] font-semibold tracking-tight">{customer.name}</h1>
        </div>
        <DetailActions favorite={customer.favorite} onToggleFavorite={onToggleFavorite} onEdit={onEdit} onDelete={onDelete} />
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard title={t("customer.projects")} onAdd={onAddProject} empty={t("customer.noProjects")}>
          {projects.map((p) => (
            <ListRow key={p.id} onClick={() => onSelect({ kind: "project", id: p.id })}>
              <span className="truncate">
                {p.name}
                {p.domain && <span className="text-muted-foreground"> · {p.domain}</span>}
              </span>
              <Badge variant="secondary">{stackLabel(p.stack)}</Badge>
            </ListRow>
          ))}
        </ListCard>

        <ListCard title={t("customer.servers")} onAdd={onAddServer} empty={t("customer.noServers")}>
          {servers.map((s) => (
            <ListRow key={s.id} onClick={() => onSelect({ kind: "server", id: s.id })}>
              <span className="flex items-center gap-2 truncate">
                <HealthDot health={serverHealth(s.facts)} />
                {s.name}
                {s.customerId !== customer.id && <span className="text-muted-foreground text-xs">{t("customer.ownServer")}</span>}
              </span>
              <span className="text-muted-foreground text-xs">{providerLabel(s.provider)}</span>
            </ListRow>
          ))}
        </ListCard>
      </div>

      {customer.notes && <NotesCard notes={customer.notes} />}
    </div>
  );
}

function ListCard({ title, onAdd, empty, children }: { title: string; onAdd: () => void; empty: string; children: ReactNode[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus /> {t("customer.new")}
        </Button>
      </CardHeader>
      <CardContent className="divide-y">
        {children.length === 0 ? <p className="text-muted-foreground text-sm">{empty}</p> : children}
      </CardContent>
    </Card>
  );
}

function ListRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="hover:bg-muted/50 -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm"
    >
      {children}
    </button>
  );
}
