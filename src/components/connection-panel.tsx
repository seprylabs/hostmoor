import { CircleAlert, CircleCheck, Copy, Loader2, Plug, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { connectionHelp } from "@/lib/ssh-help";
import { cn } from "@/lib/utils";
import type { ConnectionResult, Server } from "@/types";

const toneStyle = {
  ok: { icon: CircleCheck, className: "text-success" },
  warn: { icon: TriangleAlert, className: "text-warning" },
  error: { icon: CircleAlert, className: "text-danger" },
} as const;

interface Props {
  server: Server;
  /** Letztes Ergebnis, vom Verbindungstest oder von „Jetzt prüfen“ */
  result: ConnectionResult | null;
  /** Stand des Servers beim Test; die Anleitung bleibt so stehen, auch wenn unterwegs der Key-Pfad gespeichert wird */
  testedServer: Server;
  running: boolean;
  disabled?: boolean;
  onTest: () => void;
  onSaveKeyPath: (path: string) => Promise<boolean>;
}

export function ConnectionPanel({ server, result, testedServer, running, disabled, onTest, onSaveKeyPath }: Props) {
  const { t } = useTranslation();
  const help = result && connectionHelp(result.status, testedServer);
  const tone = help && toneStyle[help.tone];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("connection.panel.title")}</CardTitle>
        <Button size="sm" variant="outline" onClick={onTest} disabled={running || disabled}>
          {running ? <Loader2 className="animate-spin" /> : <Plug />}
          {running ? t("connection.panel.testing") : t("connection.panel.test")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!help && !running && (
          <p className="text-muted-foreground">
            {t("connection.panel.intro")}
          </p>
        )}

        {help && tone && result && (
          <>
            <div className="flex gap-3">
              <tone.icon className={cn("mt-0.5 size-5 shrink-0", tone.className)} />
              <div className="space-y-1">
                <p className="font-medium">
                  {help.title}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {t("connection.panel.duration", { seconds: (result.durationMs / 1000).toFixed(1) })}
                  </span>
                </p>
                <p className="text-muted-foreground">{help.explanation}</p>
              </div>
            </div>

            {help.steps.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <p className="font-medium">{t("connection.panel.howToFix")}</p>
                <ol className="space-y-3">
                  {help.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p>{step.text}</p>
                        {step.command && <CommandLine command={step.command} />}
                        {step.keyPath && (
                          <CommandLine command={step.keyPath} copyLabel="path">
                            {server.sshKeyPath === step.keyPath ? (
                              <span className="text-success flex items-center gap-1 px-2 text-xs">
                                <CircleCheck className="size-3.5" /> {t("connection.panel.saved")}
                              </span>
                            ) : (
                              <Button size="xs" onClick={() => onSaveKeyPath(step.keyPath!)} disabled={disabled}>
                                {t("connection.panel.apply")}
                              </Button>
                            )}
                          </CommandLine>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="text-muted-foreground text-xs">
                  {t("connection.panel.selfRun")}
                </p>
              </div>
            )}

            {result.detail && (
              <details className="text-muted-foreground">
                <summary className="cursor-pointer text-xs">{t("connection.panel.sshMessage")}</summary>
                <pre className="bg-muted mt-2 max-h-48 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                  {result.detail}
                </pre>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CommandLine({
  command,
  copyLabel = "command",
  children,
}: {
  command: string;
  copyLabel?: "command" | "path";
  /** Weitere Aktion rechts neben dem Kopieren */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(copyLabel === "path" ? t("connection.commandLine.pathCopied") : t("connection.commandLine.commandCopied"));
    } catch {
      toast.error(t("connection.commandLine.copyFailed"));
    }
  };

  return (
    <div className="bg-muted flex items-center gap-2 rounded-md py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap">{command}</code>
      <Button variant="ghost" size="icon-sm" onClick={copy} title={t("connection.commandLine.copy")}
        aria-label={copyLabel === "path" ? t("connection.commandLine.copyPath") : t("connection.commandLine.copyCommand")}>
        <Copy />
      </Button>
      {children}
    </div>
  );
}
