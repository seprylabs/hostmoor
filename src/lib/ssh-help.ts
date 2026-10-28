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
  const user = server.sshUser ?? "deinem Benutzer";

  const confirmHost: HelpStep = {
    text: "Einmal selbst im Terminal verbinden und die Frage „Are you sure you want to continue connecting?“ mit yes beantworten. Danach kannst du die Verbindung mit exit wieder schließen.",
    command: sshCommand,
  };
  const retry: HelpStep = { text: "Danach hier erneut „Verbindung testen“ klicken." };

  switch (status) {
    case "ok":
      return {
        tone: "ok",
        title: "Verbindung steht",
        explanation: `Die Anmeldung als ${user} klappt. Der Server ist bereit für den Server-Check.`,
        steps: [],
      };

    case "unknownHost":
      return {
        tone: "warn",
        title: "Server ist noch unbekannt",
        explanation:
          "Dein Mac hat sich mit diesem Server noch nie verbunden. Damit sich niemand als dein Server ausgeben kann, bestätigt die App neue Server nicht automatisch.",
        steps: [confirmHost, retry],
      };

    case "hostKeyChanged": {
      const knownHostsEntry = server.port !== 22 ? `[${server.host}]:${server.port}` : server.host;
      return {
        tone: "error",
        title: "Achtung: Der Server-Schlüssel hat sich geändert",
        explanation:
          "Das passiert, wenn der Server neu installiert wurde. Es kann aber auch bedeuten, dass sich jemand als dein Server ausgibt. Mach nur weiter, wenn du sicher bist, dass der Server neu aufgesetzt wurde.",
        steps: [
          { text: "Nur wenn du sicher bist: den alten Eintrag entfernen.", command: `ssh-keygen -R ${shellPath(knownHostsEntry)}` },
          confirmHost,
          retry,
        ],
      };
    }

    case "authFailed": {
      const steps: HelpStep[] = [];
      if (!server.sshUser) {
        steps.push({
          text: "Es ist kein SSH-Benutzer eingetragen. Trag im Server-Formular den richtigen ein, z. B. root, deploy oder forge.",
        });
      }
      if (!server.sshKeyPath) {
        steps.push(
          {
            text: `Eigenen Key für diesen Server erzeugen. Er landet unter ${key} und funktioniert danach auch ganz normal im Terminal. Hast du schon einen Key, den du nutzen willst, trag stattdessen dessen Pfad im Server-Formular ein.`,
            command: `ssh-keygen -t ed25519 -f ${shellPath(key)} -C ${keyComment(server)}`,
          },
          { text: "Diesen Key für den Server übernehmen:", keyPath: key },
        );
      }
      steps.push(
        {
          text: "Öffentlichen Key auf den Server kopieren. Das fragt einmalig nach dem Server-Passwort:",
          command: `ssh-copy-id -i ${shellPath(`${key}.pub`)}${portFlag(server)} ${destination(server)}`,
        },
        {
          text: "Kein Passwort-Login möglich? Dann den öffentlichen Key in die Zwischenablage kopieren und im Panel deines Hosters (bzw. Forge, Plesk …) unter „SSH-Keys“ einfügen:",
          command: `pbcopy < ${shellPath(`${key}.pub`)}`,
        },
        {
          text: "Hat dein Key eine Passphrase? Die App kann sie nicht abfragen. Hinterlege sie einmal im macOS-Schlüsselbund:",
          command: `ssh-add --apple-use-keychain ${shellPath(key)}`,
        },
        retry,
      );
      return {
        tone: "error",
        title: "Key wird nicht akzeptiert",
        explanation: `Der Server ist erreichbar, aber die Anmeldung als ${user} klappt nicht. Meist ist der öffentliche Key noch nicht auf dem Server hinterlegt.`,
        steps,
      };
    }

    case "keyNotFound":
      return {
        tone: "error",
        title: "Key-Datei nicht gefunden",
        explanation: `Unter ${key} liegt keine Datei. Prüfe den Pfad im Server-Formular oder erzeuge einen neuen Key.`,
        steps: [
          { text: "Vorhandene Keys anzeigen:", command: "ls ~/.ssh" },
          { text: "Oder einen neuen Key unter genau diesem Pfad erzeugen:", command: `ssh-keygen -t ed25519 -f ${shellPath(key)} -C ${keyComment(server)}` },
          { text: "Danach den öffentlichen Key auf den Server bringen und erneut testen." },
        ],
      };

    case "keyPermissions":
      return {
        tone: "error",
        title: "Key-Datei ist für andere lesbar",
        explanation: "ssh verwendet den Key aus Sicherheitsgründen nicht, solange andere Benutzer ihn lesen könnten.",
        steps: [{ text: "Rechte auf „nur du“ setzen:", command: `chmod 600 ${shellPath(key)}` }, retry],
      };

    case "dnsFailed":
      return {
        tone: "error",
        title: "Host nicht gefunden",
        explanation: `Der Name „${server.host}“ lässt sich nicht auflösen. Prüfe die Schreibweise oder trag direkt die IP-Adresse ein.`,
        steps: [],
      };

    case "refused":
      return {
        tone: "error",
        title: "Verbindung abgelehnt",
        explanation: `Der Server antwortet, aber auf Port ${server.port} läuft kein SSH. Oft ist der Port falsch (Standard: 22) oder SSH ist auf dem Server nicht aktiv.`,
        steps: [],
      };

    case "timeout":
      return {
        tone: "error",
        title: "Keine Antwort vom Server",
        explanation: `Innerhalb von 8 Sekunden kam keine Antwort. Häufige Gründe: falsche IP, Server ist aus, oder eine Firewall (z. B. im Hetzner-Panel) blockiert Port ${server.port}.`,
        steps: [],
      };

    case "unreachable":
      return {
        tone: "error",
        title: "Server nicht erreichbar",
        explanation: "Das Netzwerk findet keinen Weg zum Server. Bist du im richtigen Netz bzw. VPN, und stimmt die IP?",
        steps: [],
      };

    case "invalidConfig":
      return {
        tone: "error",
        title: "Eingaben prüfen",
        explanation: "Host oder Benutzer enthalten Zeichen, die nicht erlaubt sind. Bitte im Server-Formular korrigieren.",
        steps: [],
      };

    case "unknown":
      return {
        tone: "error",
        title: "Verbindung fehlgeschlagen",
        explanation: "Die Ursache ließ sich nicht automatisch erkennen. Die Meldung von ssh steht unten in den Details.",
        steps: [{ text: "Zum Nachvollziehen selbst im Terminal ausprobieren:", command: `${sshCommand} -v` }],
      };
  }
}
