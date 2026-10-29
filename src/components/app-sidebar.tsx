import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Activity,
  ArchiveRestore,
  Building2,
  ChevronRight,
  CircleDashed,
  Download,
  Ellipsis,
  Globe,
  Languages,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server as ServerIcon,
  Star,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { ProjectStatusIcons } from "@/components/deploy-status";
import { HealthDot } from "@/components/health-dot";
import { useActiveRuns } from "@/hooks/use-ci-overview";
import { useRunningDeploys } from "@/hooks/use-live-deploys";
import { applyLanguage, languageSetting, type LanguageSetting } from "@/i18n";
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
  const { t } = useTranslation();
  const [language, setLanguage] = useState<LanguageSetting>(languageSetting);
  const activeRuns = useActiveRuns();
  const runningDeploys = useRunningDeploys();
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

  // Eigene Deploys zuerst, dann CI-Läufe; beide führen zum Projekt
  const running = [
    ...runningDeploys.map((d) => {
      const project = projects.find((p) => p.id === d.projectId);
      const server = project?.serverId ? serverById.get(project.serverId) : undefined;
      const label = server ? t("sidebar.deployTo", { server: server.name }) : t("sidebar.deploy");
      return { key: `deploy-${d.deployId}`, projectId: d.projectId, deploy: true, queued: false, label, title: label };
    }),
    ...activeRuns.map(({ projectId, run }) => ({
      key: `ci-${projectId}-${run.id}`,
      projectId,
      deploy: false,
      queued: run.status === "queued",
      label:
        run.status === "queued"
          ? t("sidebar.queued", { workflow: run.workflow ?? run.title })
          : (run.workflow ?? run.title),
      title: `${run.title}${run.branch ? ` · ${run.branch}` : ""}`,
    })),
  ];

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
              {t("sidebar.customers")}
            </ToggleGroupItem>
            <ToggleGroupItem value="server" className={toggleItemClass}>
              {t("sidebar.servers")}
            </ToggleGroupItem>
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={t("sidebar.create")} title={t("sidebar.create")}>
                <Plus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <DropdownMenuItem onSelect={() => onCreate("customer")}>
                <Building2 /> {t("sidebar.newCustomer")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCreate("server")}>
                <ServerIcon /> {t("sidebar.newServer")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={customers.length === 0} onSelect={() => onCreate("project")}>
                <Globe /> {t("sidebar.newProject")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50" />
          <SidebarInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sidebar.search")}
            className="pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {isEmpty && (
          <p className="text-muted-foreground px-4 py-2 text-sm">
            <Trans i18nKey="sidebar.empty" components={{ icon: <Plus className="inline size-3.5" /> }} />
          </p>
        )}

        {favorites.length > 0 && (
          <SidebarGroup className="py-0.5">
            <SidebarGroupLabel className="h-7">
              <Star className="mr-1.5 size-3 fill-current" /> {t("sidebar.favorites")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {favorites.map((fav) => (
                  <SidebarMenuItem key={`${fav.kind}-${fav.id}`}>
                    <SidebarMenuButton
                      isActive={isSelected(fav.kind, fav.id)}
                      onClick={() => onSelect({ kind: fav.kind, id: fav.id })}
                      className="h-7"
                    >
                      <fav.icon />
                      <span className="truncate">{fav.name}</span>
                      {fav.kind === "project" && <ProjectStatusIcons projectId={fav.id} className="ml-auto" />}
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
                  <SidebarGroup className="py-0.5">
                    <SidebarGroupLabel asChild>
                      <button
                        onClick={() => onSelect({ kind: "customer", id: customer.id })}
                        className={cn(
                          "hover:text-sidebar-foreground h-7 w-full text-left",
                          isSelected("customer", customer.id) && "text-sidebar-foreground",
                        )}
                      >
                        {customer.name}
                      </button>
                    </SidebarGroupLabel>
                    <CollapsibleTrigger asChild>
                      <SidebarGroupAction
                        className="top-1.5"
                        title={open ? t("sidebar.collapse") : t("sidebar.expand")}
                        aria-label={open ? t("sidebar.collapse") : t("sidebar.expand")}
                      >
                        <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
                      </SidebarGroupAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarGroupContent>
                        <SidebarMenu>
                          {items.length === 0 && (
                            <p className="text-muted-foreground/70 px-2 text-xs">{t("sidebar.noProjects")}</p>
                          )}
                          {items.map((project) => {
                            const server = project.serverId ? serverById.get(project.serverId) : undefined;
                            return (
                              <SidebarMenuItem key={project.id}>
                                <SidebarMenuButton
                                  isActive={isSelected("project", project.id)}
                                  onClick={() => onSelect({ kind: "project", id: project.id })}
                                  title={`${stackLabel(project.stack)} · ${server?.name ?? t("sidebar.noServer")}`}
                                  className="h-7"
                                >
                                  <Globe />
                                  <span className="truncate">{project.name}</span>
                                  {/* Bekommt nur den Platz, den der Projektname übrig lässt */}
                                  <span className="text-muted-foreground min-w-0 flex-1 basis-0 truncate pl-1 text-right text-xs">
                                    {server?.name}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1.5">
                                    <ProjectStatusIcons projectId={project.id} />
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
              { key: "own", label: t("sidebar.ownServers"), list: servers.filter((s) => !s.customerId) },
              { key: "customer", label: t("sidebar.customerServers"), list: servers.filter((s) => s.customerId) },
            ].map(({ key, label, list }) => {
              const items = list.filter(matchesServer);
              if (items.length === 0) return null;
              return (
                <SidebarGroup key={key} className="py-0.5">
                  <SidebarGroupLabel className="h-7">{label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {items.map((server) => {
                        const hosted = projects.filter((p) => p.serverId === server.id);
                        return (
                          <SidebarMenuItem key={server.id}>
                            <SidebarMenuButton
                              isActive={isSelected("server", server.id)}
                              onClick={() => onSelect({ kind: "server", id: server.id })}
                              className="h-7"
                            >
                              <ServerIcon />
                              <span className="truncate">{server.name}</span>
                              <span className="text-muted-foreground ml-auto text-xs">
                                {providerLabel(server.provider)}
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
                                      <ProjectStatusIcons projectId={project.id} className="ml-auto" />
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

      <SidebarFooter>
        {running.length > 0 && (
          <div className="bg-sidebar-accent/60 ring-sidebar-border rounded-lg p-1 ring-1">
            <p className="text-muted-foreground flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-xs font-medium">
              <Activity className="size-3" /> {t("sidebar.running")}
              <span className="ml-auto tabular-nums">{running.length}</span>
            </p>
            <div className="max-h-40 overflow-y-auto">
              {running.map((item) => (
                <button
                  key={item.key}
                  onClick={() => onSelect({ kind: "project", id: item.projectId })}
                  className={cn(
                    "hover:bg-sidebar-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                    isSelected("project", item.projectId) && "bg-sidebar-accent",
                  )}
                  title={item.title}
                >
                  {item.queued ? (
                    <CircleDashed className="text-muted-foreground size-3.5 shrink-0" />
                  ) : (
                    <Loader2 className={cn("size-3.5 shrink-0 animate-spin", item.deploy ? "text-info" : "text-ci")} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{projects.find((p) => p.id === item.projectId)?.name ?? t("sidebar.projectFallback")}</span>
                    <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                      {item.deploy ? <Rocket className="size-3 shrink-0" /> : <Workflow className="size-3 shrink-0" />}
                      <span className="truncate">{item.label}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground flex items-center gap-3 px-2 text-xs tabular-nums">
            <span className="flex items-center gap-1" title={t("sidebar.customerCount", { count: customers.length })}>
              <Building2 className="size-3.5" /> {customers.length}
            </span>
            <span className="flex items-center gap-1" title={t("sidebar.projectCount", { count: projects.length })}>
              <Globe className="size-3.5" /> {projects.length}
            </span>
            <span className="flex items-center gap-1" title={t("sidebar.serverCount", { count: servers.length })}>
              <ServerIcon className="size-3.5" /> {servers.length}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("sidebar.moreActions")} title={t("sidebar.moreActions")}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-auto min-w-56">
              <DropdownMenuItem disabled={servers.length === 0 || checkAll !== null} onSelect={onCheckAll}>
                <RefreshCw className={checkAll ? "animate-spin" : undefined} />
                {checkAll
                  ? t("sidebar.checkProgress", { done: checkAll.done, total: checkAll.total })
                  : t("sidebar.checkAll")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onExport}>
                <Download /> {t("sidebar.exportBackup")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onImport}>
                <ArchiveRestore /> {t("sidebar.restoreBackup")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Languages /> {t("language.label")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={language}
                    onValueChange={(value) => {
                      const setting = value as LanguageSetting;
                      setLanguage(setting);
                      void applyLanguage(setting);
                    }}
                  >
                    <DropdownMenuRadioItem value="system">{t("language.system")}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="de">Deutsch</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
