export type Provider = "hetzner" | "netcup" | "ionos" | "digitalocean" | "aws" | "other";

export type Stack = "laravel" | "wordpress" | "static" | "other";

export interface Customer {
  id: string;
  name: string;
  notes?: string | null;
  favorite?: boolean;
}

export interface Server {
  id: string;
  name: string;
  provider: Provider;
  /** Hostname oder IP */
  host: string;
  port: number;
  sshUser?: string | null;
  /** Nur der Pfad zum Key; die App liest die Datei nie */
  sshKeyPath?: string | null;
  /** Kunde, dem der Server gehört. Leer = eigener Server */
  customerId?: string | null;
  notes?: string | null;
  favorite?: boolean;
  /** Wird ausschließlich vom SSH-Check gesetzt */
  facts?: ServerFacts | null;
}

export interface Project {
  id: string;
  name: string;
  customerId: string;
  serverId?: string | null;
  stack: Stack;
  domain?: string | null;
  /** Pfad auf dem Server, z. B. /var/www/shop */
  path?: string | null;
  repoUrl?: string | null;
  notes?: string | null;
  favorite?: boolean;
}

export interface Snapshot {
  customers: Customer[];
  servers: Server[];
  projects: Project[];
}

export type EntityKind = "customer" | "server" | "project";

/** Ergebnis eines Server-Checks per SSH */
export interface ServerFacts {
  checkedAt: string;
  os: { name: string; version: string; kernel: string };
  uptimeSeconds: number;
  cpu: { cores: number; load: [number, number, number] };
  memory: { totalMb: number; usedMb: number };
  disks: { mount: string; totalGb: number; usedGb: number }[];
  php?: {
    version: string;
    installed: string[];
    extensions: string[];
    memoryLimit: string;
    uploadMaxFilesize: string;
  };
  composer?: string;
  node?: string;
  npm?: string;
  git?: string;
  wpCli?: string;
  webserver?: { name: string; version: string };
  database?: { name: string; version: string };
  redis?: string;
}

export type Selection = { kind: EntityKind; id: string };
