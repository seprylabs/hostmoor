export type LogLevel = "error" | "warning" | "info";

export interface LogEntry {
  level: LogLevel;
  /** First line plus continuation lines such as a stack trace */
  text: string;
}

const ERROR = /^(error|critical|alert|emergency|emerg|crit|fatal)$/i;
const WARNING = /^(warning|warn|notice)$/i;

function toLevel(word: string | undefined): LogLevel | null {
  if (!word) return null;
  if (ERROR.test(word)) return "error";
  if (WARNING.test(word)) return "warning";
  return "info";
}

// Laravel/Monolog: [2026-11-10 09:12:01] production.ERROR: …
const LARAVEL = /^\[\d{4}-\d{2}-\d{2}[ T][^\]]*\]\s+[\w-]+\.([A-Z]+):/;
// nginx: 2026/11/10 09:12:01 [error] …  · Apache: [Tue Nov 10 …] [php:error] … or [core:warn] …
const BRACKETED = /\[(?:[\w-]+:)?(emerg|alert|crit|error|warn|notice|info|debug)\]/i;
// PHP / PHP-FPM: PHP Fatal error: … · [10-Nov-2026 09:12:01 UTC] PHP Warning: … · WARNING: [pool www] …
const PHP = /\bPHP (Fatal error|Parse error|Warning|Notice|Deprecated)\b/;
const FPM = /^\[[^\]]+\]\s+(ERROR|WARNING|NOTICE|ALERT):/;
/** Line that starts a new entry in date-prefixed logs */
const DATED = /^(\[\d{1,4}[-/]|\d{4}[-/]\d{2}[-/]\d{2})/;

function lineLevel(line: string): LogLevel | null {
  const laravel = LARAVEL.exec(line);
  if (laravel) return toLevel(laravel[1]);
  const php = PHP.exec(line);
  if (php) return /error/i.test(php[1]) ? "error" : "warning";
  const fpm = FPM.exec(line);
  if (fpm) return toLevel(fpm[1]);
  const bracketed = BRACKETED.exec(line);
  if (bracketed) return toLevel(bracketed[1]);
  return null;
}

/**
 * Groups log lines into entries. In logs where entries start with a date (Laravel, PHP),
 * the lines after it (stack traces, JSON context) belong to that entry.
 */
export function parseLog(lines: string[]): LogEntry[] {
  const dated = lines.some((l) => DATED.test(l));
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const starts = !dated || DATED.test(line) || entries.length === 0;
    if (starts) {
      entries.push({ level: lineLevel(line) ?? "info", text: line });
    } else {
      entries[entries.length - 1].text += `\n${line}`;
    }
  }
  return entries;
}

export type LevelFilter = "all" | "warning" | "error";

export function matches(entry: LogEntry, filter: LevelFilter, search: string): boolean {
  if (filter === "error" && entry.level !== "error") return false;
  if (filter === "warning" && entry.level === "info") return false;
  return !search || entry.text.toLowerCase().includes(search.toLowerCase());
}

/** Suggested log files for a new project, relative to the project folder */
export function suggestedLogPaths(stack: string): string[] {
  if (stack === "laravel") return ["storage/logs/laravel.log"];
  if (stack === "wordpress") return ["wp-content/debug.log"];
  return [];
}
