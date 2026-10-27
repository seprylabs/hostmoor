import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { percent } from "@/lib/format";

/** Eine Zeile "Bezeichnung … Wert"; fehlende Werte werden als "nicht gefunden" angezeigt */
export function FactRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {value ? (
        <span className="font-mono text-right">{value}</span>
      ) : (
        <span className="text-muted-foreground/60 italic">nicht gefunden</span>
      )}
    </div>
  );
}

export function UsageBar({
  label,
  used,
  total,
  unit,
}: {
  label: string;
  used: number;
  total: number;
  unit: string;
}) {
  const pct = percent(used, total);
  return (
    <div className="space-y-1.5 py-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          {used} / {total} {unit} <span className="text-muted-foreground">({pct} %)</span>
        </span>
      </div>
      <Progress value={pct} className={pct >= 85 ? "[&>*]:bg-warning" : undefined} />
    </div>
  );
}

export function NotesCard({ notes }: { notes: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notizen</CardTitle>
      </CardHeader>
      <CardContent className="text-sm whitespace-pre-wrap">{notes}</CardContent>
    </Card>
  );
}
