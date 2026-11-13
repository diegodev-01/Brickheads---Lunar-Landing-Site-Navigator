import type { ReactNode } from "react";
import type { Provenance } from "@/domain/types";

export function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

const PROVENANCE_STYLE: Record<Provenance, string> = {
  real: "border-good/40 text-good",
  derived: "border-earth/40 text-earth",
  mock: "border-bad/50 text-bad",
};

const PROVENANCE_LABEL: Record<Provenance, string> = {
  real: "NASA data",
  derived: "derived from NASA data",
  mock: "MOCK",
};

export function ProvenanceBadge({ value, title }: { value: Provenance; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] whitespace-nowrap ${PROVENANCE_STYLE[value]}`}
    >
      {PROVENANCE_LABEL[value]}
    </span>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "bad" | "warn";
}) {
  const cls =
    tone === "bad"
      ? "border-bad/50 text-bad"
      : tone === "warn"
        ? "border-warn/50 text-warn"
        : "border-line text-muted";
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-px text-[10px] whitespace-nowrap ${cls}`}
    >
      {children}
    </span>
  );
}
