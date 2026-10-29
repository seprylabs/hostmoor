import i18n from "i18next";

import type { ConnectionStatus, Server } from "@/types";

export interface HelpStep {
  text: string;
  /** Befehl zum Kopieren; wird vom Nutzer selbst im Terminal ausgeführt */
  command?: string;
  /** Key-Pfad, den die App per Knopfdruck beim Server speichern kann */
  keyPath?: string;
}

export interface ConnectionHelp {
  tone: "ok" | "warn" | "error";
  title: string;
  explanation: string;
  steps: HelpStep[];
}

const DEFAULT_KEY = "~/.ssh/id_ed25519";

/** Für die Shell quoten; ein führendes ~/ bleibt frei, damit die Shell es auflöst */
function shellPath(path: string): string {
  const quote = (s: string) => (/^[\w./@:+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return path.startsWith("~/") ? `~/${quote(path.slice(2))}` : quote(path);
}

function destination(server: Server) {
  return server.sshUser ? `${server.sshUser}@${server.host}` : server.host;
}

/** Vorschlag für einen eigenen Key pro Server, z. B. ~/.ssh/id_ed25519_kunde-web01 */
function suggestedKeyPath(server: Server) {
  const slug = (server.name || server.host)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `~/.ssh/id_ed25519_${slug || "server"}`;
}

/** Kommentar im öffentlichen Key, damit man ihn auf dem Server wiedererkennt */
function keyComment(server: Server) {
  return `'${`${server.name || server.host} (StackPort)`.replace(/'/g, `'\\''`)}'`;
}

function portFlag(server: Server) {
  return server.port !== 22 ? ` -p ${server.port}` : "";
}

export function connectionHelp(status: ConnectionStatus, server: Server): ConnectionHelp {
  const key = server.sshKeyPath ?? (status === "authFailed" ? suggestedKeyPath(server) : DEFAULT_KEY);
  const keyFlag = server.sshKeyPath ? ` -i ${shellPath(server.sshKeyPath)}` : "";
  const sshCommand = `ssh${keyFlag}${portFlag(server)} ${destination(server)}`;
  const user = server.sshUser;

  const confirmHost: HelpStep = {
    text: i18n.t("sshHelp.confirmHost"),
    command: sshCommand,
  };
  const retry: HelpStep = { text: i18n.t("sshHelp.retry", { action: i18n.t("connection.panel.test") }) };

  switch (status) {
    case "ok":
      return {
        tone: "ok",
        title: i18n.t("sshHelp.ok.title"),
        explanation: user ? i18n.t("sshHelp.ok.explanation", { user }) : i18n.t("sshHelp.ok.explanationNoUser"),
        steps: [],
      };

    case "unknownHost":
      return {
        tone: "warn",
        title: i18n.t("sshHelp.unknownHost.title"),
        explanation:
          i18n.t("sshHelp.unknownHost.explanation"),
        steps: [confirmHost, retry],
      };

    case "hostKeyChanged": {
      const knownHostsEntry = server.port !== 22 ? `[${server.host}]:${server.port}` : server.host;
      return {
        tone: "error",
        title: i18n.t("sshHelp.hostKeyChanged.title"),
        explanation:
          i18n.t("sshHelp.hostKeyChanged.explanation"),
        steps: [
          { text: i18n.t("sshHelp.hostKeyChanged.removeEntry"), command: `ssh-keygen -R ${shellPath(knownHostsEntry)}` },
          confirmHost,
          retry,
        ],
      };
    }

    case "authFailed": {
      const steps: HelpStep[] = [];
      if (!server.sshUser) {
        steps.push({
          text: i18n.t("sshHelp.authFailed.noUser"),
        });
      }
      if (!server.sshKeyPath) {
        steps.push(
          {
            text: i18n.t("sshHelp.authFailed.generateKey", { key }),
            command: `ssh-keygen -t ed25519 -f ${shellPath(key)} -C ${keyComment(server)}`,
          },
          { text: i18n.t("sshHelp.authFailed.useKey"), keyPath: key },
        );
      }
      steps.push(
        {
          text: i18n.t("sshHelp.authFailed.copyId"),
          command: `ssh-copy-id -i ${shellPath(`${key}.pub`)}${portFlag(server)} ${destination(server)}`,
        },
        {
          text: i18n.t("sshHelp.authFailed.pbcopy"),
          command: `pbcopy < ${shellPath(`${key}.pub`)}`,
        },
        {
          text: i18n.t("sshHelp.authFailed.passphrase"),
          command: `ssh-add --apple-use-keychain ${shellPath(key)}`,
        },
        retry,
      );
      return {
        tone: "error",
        title: i18n.t("sshHelp.authFailed.title"),
        explanation: user
          ? i18n.t("sshHelp.authFailed.explanation", { user })
          : i18n.t("sshHelp.authFailed.explanationNoUser"),
        steps,
      };
    }

    case "keyNotFound":
      return {
        tone: "error",
        title: i18n.t("sshHelp.keyNotFound.title"),
        explanation: i18n.t("sshHelp.keyNotFound.explanation", { key }),
        steps: [
          { text: i18n.t("sshHelp.keyNotFound.listKeys"), command: "ls ~/.ssh" },
          { text: i18n.t("sshHelp.keyNotFound.generateKey"), command: `ssh-keygen -t ed25519 -f ${shellPath(key)} -C ${keyComment(server)}` },
          { text: i18n.t("sshHelp.keyNotFound.copyAndRetry") },
        ],
      };

    case "keyPermissions":
      return {
        tone: "error",
        title: i18n.t("sshHelp.keyPermissions.title"),
        explanation: i18n.t("sshHelp.keyPermissions.explanation"),
        steps: [{ text: i18n.t("sshHelp.keyPermissions.chmod"), command: `chmod 600 ${shellPath(key)}` }, retry],
      };

    case "dnsFailed":
      return {
        tone: "error",
        title: i18n.t("sshHelp.dnsFailed.title"),
        explanation: i18n.t("sshHelp.dnsFailed.explanation", { host: server.host }),
        steps: [],
      };

    case "refused":
      return {
        tone: "error",
        title: i18n.t("sshHelp.refused.title"),
        explanation: i18n.t("sshHelp.refused.explanation", { port: server.port }),
        steps: [],
      };

    case "timeout":
      return {
        tone: "error",
        title: i18n.t("sshHelp.timeout.title"),
        explanation: i18n.t("sshHelp.timeout.explanation", { port: server.port }),
        steps: [],
      };

    case "unreachable":
      return {
        tone: "error",
        title: i18n.t("sshHelp.unreachable.title"),
        explanation: i18n.t("sshHelp.unreachable.explanation"),
        steps: [],
      };

    case "invalidConfig":
      return {
        tone: "error",
        title: i18n.t("sshHelp.invalidConfig.title"),
        explanation: i18n.t("sshHelp.invalidConfig.explanation"),
        steps: [],
      };

    case "unknown":
      return {
        tone: "error",
        title: i18n.t("sshHelp.unknown.title"),
        explanation: i18n.t("sshHelp.unknown.explanation"),
        steps: [{ text: i18n.t("sshHelp.unknown.verbose"), command: `${sshCommand} -v` }],
      };
  }
}
