import { useMemo, useState } from "react";
import {
  ArchiveRestore,
  Building2,
  ChevronRight,
  Download,
  Ellipsis,
  Globe,
  Plus,
  RefreshCw,
  Search,
  Server as ServerIcon,
  Star,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DeployStatusIcon } from "@/components/deploy-status";
import { HealthDot } from "@/components/health-dot";
import { cn } from "@/lib/utils";
import { providerLabel, serverHealth, stackLabel } from "@/lib/format";
import type { Customer, EntityKind, Project, Selection, Server } from "@/types";

type GroupBy = "customer" | "server";

const COLLAPSED_KEY = "stackport-collapsed-customers";

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** Gemeinsamer Stil für den aktiven Eintrag im Kunden/Server-Umschalter */
const toggleItemClass =
  "flex-1 data-[state=on]:bg-sidebar-accent data-[state=on]:text-sidebar-accent-foreground data-[state=on]:font-medium";

interface Props {
  customers: Customer[];
  servers: Server[];
  projects: Project[];
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  onCreate: (kind: EntityKind) => void;
  onExport: () => void;
  onImport: () => void;
  onCheckAll: () => void;
  /** Fortschritt von „Alle Server prüfen“, null = läuft nicht */
  checkAll: { done: number; total: number } | null;
}

export function AppSidebar({
  customers,
  servers,
  projects,
  selection,
  onSelect,
  onCreate,
  onExport,
  onImport,
  onCheckAll,
  checkAll,
}: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("customer");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  const setCustomerOpen = (id: string, open: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // nur Komfort, darf fehlschlagen
      }
      return next;
    });
  };

  const serverById = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers]);

  const q = query.trim().toLowerCase();
  const has = (value?: string | null) => (value ?? "").toLowerCase().includes(q);
  const matchesProject = (p: Project) => !q || has(p.name) || has(p.domain);
  const matchesServer = (s: Server) => !q || has(s.name) || has(s.host);

  const isSelected = (kind: Selection["kind"], id: string) => selection?.kind === kind && selection.id === id;

  const isEmpty = customers.length === 0 && servers.length === 0;

  const favorites = [
    ...customers
      .filter((c) => c.favorite && (!q || has(c.name)))
      .map((c) => ({ kind: "customer" as const, id: c.id, name: c.name, icon: Building2 })),
    ...projects
      .filter((p) => p.favorite && matchesProject(p))
      .map((p) => ({ kind: "project" as const, id: p.id, name: p.name, icon: Globe })),
    ...servers
      .filter((s) => s.favorite && matchesServer(s))
      .map((s) => ({ kind: "server" as const, id: s.id, name: s.name, icon: ServerIcon })),
  ].sort((a, b) => a.name.localeCompare(b.name, "de"));

  return (
    <Sidebar>
      {/* Platz für die macOS-Ampel, gleichzeitig Fenster-Ziehbereich */}
      <SidebarHeader data-tauri-drag-region className="gap-3 pt-10">
        <div className="flex gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={groupBy}
            onValueChange={(v) => v && setGroupBy(v as GroupBy)}
            className="flex-1"
          >
            <ToggleGroupItem value="customer" className={toggleItemClass}>
              Kunden
            </ToggleGroupItem>
            <ToggleGroupItem value="server" className={toggleItemClass}>
              Server
            </ToggleGroupItem>
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Neu anlegen" title="Neu anlegen">
                <Plus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <DropdownMenuItem onSelect={() => onCreate("customer")}>
                <Building2 /> Neuer Kunde
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCreate("server")}>
                <ServerIcon /> Neuer Server
              </DropdownMenuItem>
              <DropdownMenuItem disabled={customers.length === 0} onSelect={() => onCreate("project")}>
                <Globe /> Neues Projekt
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50" />
          <SidebarInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suchen…"
            className="pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {isEmpty && (
          <p className="text-muted-foreground px-4 py-2 text-sm">
            Noch leer. Lege über <Plus className="inline size-3.5" /> deinen ersten Kunden oder Server an.
          </p>
        )}

        {favorites.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Star className="mr-1.5 size-3 fill-current" /> Favoriten
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {favorites.map((fav) => (
                  <SidebarMenuItem key={`${fav.kind}-${fav.id}`}>
                    <SidebarMenuButton
                      isActive={isSelected(fav.kind, fav.id)}
                      onClick={() => onSelect({ kind: fav.kind, id: fav.id })}
                    >
                      <fav.icon />
                      <span className="truncate">{fav.name}</span>
                      {fav.kind === "project" && <DeployStatusIcon projectId={fav.id} className="ml-auto" />}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {groupBy === "customer"
          ? customers.map((customer) => {
              const customerHit = !q || has(customer.name);
              const items = projects.filter(
                (p) => p.customerId === customer.id && (customerHit || matchesProject(p)),
              );
              if (!customerHit && items.length === 0) return null;
              // Beim Suchen immer aufklappen, damit Treffer sichtbar sind
              const open = q !== "" || !collapsed.has(customer.id);
              return (
                <Collapsible
                  key={customer.id}
                  open={open}
                  onOpenChange={(o) => setCustomerOpen(customer.id, o)}
                >
                  <SidebarGroup>
                    <SidebarGroupLabel asChild>
                      <button
                        onClick={() => onSelect({ kind: "customer", id: customer.id })}
                        className={cn(
                          "hover:text-sidebar-foreground w-full text-left",
                          isSelected("customer", customer.id) && "text-sidebar-foreground",
                        )}
                      >
                        {customer.name}
                      </button>
                    </SidebarGroupLabel>
                    <CollapsibleTrigger asChild>
                      <SidebarGroupAction
                        title={open ? "Einklappen" : "Aufklappen"}
                        aria-label={open ? "Einklappen" : "Aufklappen"}
                      >
                        <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
                      </SidebarGroupAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarGroupContent>
                        <SidebarMenu>
                          {items.length === 0 && (
                            <p className="text-muted-foreground/70 px-2 text-xs">Keine Projekte</p>
                          )}
                          {items.map((project) => {
                            const server = project.serverId ? serverById.get(project.serverId) : undefined;
                            return (
                              <SidebarMenuItem key={project.id}>
                                <SidebarMenuButton
                                  isActive={isSelected("project", project.id)}
                                  onClick={() => onSelect({ kind: "project", id: project.id })}
                                  className="h-auto py-1.5"
                                >
                                  <Globe />
                                  <div className="flex min-w-0 flex-col">
                                    <span className="truncate">{project.name}</span>
                                    <span className="text-muted-foreground truncate text-xs">
                                      {stackLabel[project.stack]} · {server?.name ?? "kein Server"}
                                    </span>
                                  </div>
                                  <span className="ml-auto flex items-center gap-1.5">
                                    <DeployStatusIcon projectId={project.id} />
                                    {server && <HealthDot health={serverHealth(server.facts)} />}
                                  </span>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            );
                          })}
                        </SidebarMenu>
                      </SidebarGroupContent>
                    </CollapsibleContent>
                  </SidebarGroup>
                </Collapsible>
              );
            })
          : [
              { label: "Eigene Server", list: servers.filter((s) => !s.customerId) },
              { label: "Kundenserver", list: servers.filter((s) => s.customerId) },
            ].map(({ label, list }) => {
              const items = list.filter(matchesServer);
              if (items.length === 0) return null;
              return (
                <SidebarGroup key={label}>
                  <SidebarGroupLabel>{label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {items.map((server) => {
                        const hosted = projects.filter((p) => p.serverId === server.id);
                        return (
                          <SidebarMenuItem key={server.id}>
                            <SidebarMenuButton
                              isActive={isSelected("server", server.id)}
                              onClick={() => onSelect({ kind: "server", id: server.id })}
                            >
                              <ServerIcon />
                              <span className="truncate">{server.name}</span>
                              <span className="text-muted-foreground ml-auto text-xs">
                                {providerLabel[server.provider]}
                              </span>
                              <HealthDot health={serverHealth(server.facts)} />
                            </SidebarMenuButton>
                            {hosted.length > 0 && (
                              <SidebarMenuSub>
                                {hosted.map((project) => (
                                  <SidebarMenuSubItem key={project.id}>
                                    <SidebarMenuSubButton
                                      isActive={isSelected("project", project.id)}
                                      onClick={() => onSelect({ kind: "project", id: project.id })}
                                    >
                                      <span className="truncate">{project.domain ?? project.name}</span>
                                      <DeployStatusIcon projectId={project.id} className="ml-auto" />
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                ))}
                              </SidebarMenuSub>
                            )}
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })}
      </SidebarContent>

      <SidebarFooter className="flex-row items-center justify-between">
        <span className="text-muted-foreground px-2 text-xs">
          {customers.length} Kunden · {servers.length} Server
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen" title="Weitere Aktionen">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-auto min-w-56">
            <DropdownMenuItem disabled={servers.length === 0 || checkAll !== null} onSelect={onCheckAll}>
              <RefreshCw className={checkAll ? "animate-spin" : undefined} />
              {checkAll ? `Prüfe … ${checkAll.done} von ${checkAll.total}` : "Alle Server prüfen"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onExport}>
              <Download /> Backup exportieren…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onImport}>
              <ArchiveRestore /> Backup wiederherstellen…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
