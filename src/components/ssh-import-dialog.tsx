import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { readSshConfig } from "@/lib/api";
import { sshTarget } from "@/lib/format";
import type { ConfigHost, Server } from "@/types";

/** Git hosting entries are common in ~/.ssh/config but are no servers to manage */
const GIT_HOSTS = ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org", "ssh.dev.azure.com"];

const isGitHost = (h: ConfigHost) => GIT_HOSTS.includes(h.host.toLowerCase());

/** Same host, port and user as a server that already exists */
const isDuplicate = (h: ConfigHost, servers: Server[]) =>
  servers.some(
    (s) => s.host.toLowerCase() === h.host.toLowerCase() && s.port === h.port && (s.sshUser ?? null) === h.user,
  );

interface Props {
  open: boolean;
  servers: Server[];
  onClose: () => void;
  onImport: (servers: Server[]) => Promise<boolean>;
}

export function SshImportDialog({ open, servers, onClose, onImport }: Props) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<ConfigHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHosts(null);
    setError(null);
    readSshConfig()
      .then((list) => {
        setHosts(list);
        // Preselect what is most likely a server to add
        setSelected(new Set(list.filter((h) => !isGitHost(h) && !isDuplicate(h, servers)).map((h) => h.alias)));
      })
      .catch((e) => setError(String(e)));
    // Only when the dialog opens; saving reloads servers and must not reset the selection
  }, [open]);

  const toggle = (alias: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });

  const importable = (hosts ?? []).filter((h) => !isDuplicate(h, servers));
  const chosen = importable.filter((h) => selected.has(h.alias));

  const submit = async () => {
    setSaving(true);
    const ok = await onImport(
      chosen.map((h) => ({
        id: crypto.randomUUID(),
        name: h.alias,
        provider: "other",
        host: h.host,
        port: h.port,
        sshUser: h.user,
        sshKeyPath: h.identityFile,
        proxyJump: h.proxyJump,
        customerId: null,
        notes: null,
      })),
    );
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("sshImport.title")}</DialogTitle>
          <DialogDescription>
            <Trans i18nKey="sshImport.description" components={{ code: <code /> }} />
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-24 flex-1 overflow-y-auto border-y px-6 py-2">
          {error ? (
            <p className="text-danger py-4 text-sm">{error}</p>
          ) : hosts === null ? (
            <p className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
              <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
            </p>
          ) : hosts.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              <Trans i18nKey="sshImport.empty" components={{ code: <code /> }} />
            </p>
          ) : (
            <ul className="divide-y">
              {hosts.map((h) => {
                const duplicate = isDuplicate(h, servers);
                return (
                  <li key={h.alias}>
                    <label
                      className={
                        "flex items-start gap-3 py-2.5 " + (duplicate ? "opacity-60" : "cursor-pointer")
                      }
                    >
                      <input
                        type="checkbox"
                        className="accent-primary mt-0.5 size-4 shrink-0"
                        disabled={duplicate}
                        checked={!duplicate && selected.has(h.alias)}
                        onChange={() => toggle(h.alias)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{h.alias}</span>
                          {duplicate && <Badge variant="secondary">{t("sshImport.exists")}</Badge>}
                          {!duplicate && isGitHost(h) && <Badge variant="outline">{t("sshImport.gitHost")}</Badge>}
                        </span>
                        <span className="text-muted-foreground block truncate font-mono text-xs">
                          {sshTarget({ host: h.host, port: h.port, sshUser: h.user })}
                          {h.proxyJump && ` · ${t("server.detail.via", { jump: h.proxyJump })}`}
                          {h.identityFile && ` · ${h.identityFile}`}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex gap-1">
            {importable.length > 0 && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(importable.map((h) => h.alias)))}>
                  {t("sshImport.selectAll")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  {t("sshImport.selectNone")}
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button disabled={chosen.length === 0 || saving} onClick={submit}>
              {saving && <Loader2 className="animate-spin" />}
              {t("sshImport.import", { count: chosen.length })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
