"use client";

import { useId, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type { Extent } from "@/domain/grid/grid";
import {
  validateMissionSetup,
  type MissionSetup,
  type SetupError,
  type SetupField,
} from "@/domain/mission/setup";
import { msToJulianDay, parseUtc } from "@/domain/mission/time";
import type { LonLat, TimeWindow } from "@/domain/types";

export interface SetupValues {
  timeMs: number;
  windowDays: number;
  roiHalfKm: number;
  presetId: string;
  target: LonLat | null;
}

interface Props {
  values: SetupValues;
  coverage: TimeWindow;
  regionExtent: Extent;
  presets: readonly { id: string; label: string; description: string }[];
  /** Elevation of the current target from the DEM grid, metres (null when unknown). */
  targetElevationM: number | null;
  onApply: (setup: MissionSetup) => void;
  /** Move the landing time without re-validating everything (slip buttons). */
  onSlip: (days: number) => void;
}

const WINDOWS = [
  { days: 1, label: "1 day" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 29.53, label: "1 lunar day (29.5 d)" },
  { days: 60, label: "2 months" },
];

const ROI_SIZES = [5, 10, 20, 50];

/** "2027-01-15T06:00" (UTC) for <input type="datetime-local">. */
const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/**
 * Form state is initialised from `values`. The parent remounts the panel (via `key`) when the scenario
 * changes elsewhere (map click, slip buttons, demo), so the fields always show the active scenario.
 */
export function MissionSetupPanel({
  values,
  coverage,
  regionExtent,
  presets,
  targetElevationM,
  onApply,
  onSlip,
}: Props) {
  const uid = useId();
  const [timeIso, setTimeIso] = useState(toInput(values.timeMs));
  const [jd, setJd] = useState(msToJulianDay(values.timeMs).toFixed(4));
  const [lat, setLat] = useState(values.target?.lat.toFixed(4) ?? "");
  const [lon, setLon] = useState(values.target?.lon.toFixed(4) ?? "");
  const [roiHalfKm, setRoiHalfKm] = useState(values.roiHalfKm);
  const [windowDays, setWindowDays] = useState(values.windowDays);
  const [presetId, setPresetId] = useState(values.presetId);
  const [errors, setErrors] = useState<SetupError[]>([]);

  const errFor = (f: SetupField) => errors.filter((e) => e.field === f);
  const fieldId = (f: string) => `${uid}-${f}`;

  const apply = () => {
    const r = validateMissionSetup(
      { timeIso, lat, lon, roiHalfKm, windowDays, presetId },
      {
        coverage,
        regionExtent,
        presetIds: presets.map((p) => p.id),
        roiHalfKmRange: [1, 50],
        windowDaysRange: [1, 60],
      },
    );
    if (r.ok) {
      setErrors([]);
      onApply(r.value);
    } else setErrors(r.errors);
  };

  const onIso = (v: string) => {
    setTimeIso(v);
    const p = parseUtc(v);
    if (p.ok) setJd(msToJulianDay(p.ms).toFixed(4));
  };
  const onJd = (v: string) => {
    setJd(v);
    const n = Number(v);
    if (Number.isFinite(n) && n > 2_400_000) setTimeIso(toInput((n - 2_440_587.5) * 86_400_000));
  };

  const input =
    "w-full rounded border border-line bg-panel-2 px-2 py-1 text-sm aria-[invalid=true]:border-bad";
  const label = "mb-0.5 block text-[11px] text-muted";

  return (
    <Panel title="Mission setup">
      <form
        className="space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        noValidate
      >
        <div className="grid grid-cols-[1fr_7.5rem] gap-2">
          <div>
            <label htmlFor={fieldId("time")} className={label}>
              Landing time (UTC)
            </label>
            <input
              id={fieldId("time")}
              type="datetime-local"
              value={timeIso}
              onChange={(e) => onIso(e.target.value)}
              className={input}
              aria-invalid={errFor("time").length > 0}
              aria-describedby={`${fieldId("time")}-err`}
            />
          </div>
          <div>
            <label htmlFor={fieldId("jd")} className={label} title="Julian Day (UTC)">
              Julian Day
            </label>
            <input
              id={fieldId("jd")}
              inputMode="decimal"
              value={jd}
              onChange={(e) => onJd(e.target.value)}
              className={`${input} font-mono`}
            />
          </div>
        </div>
        <FieldErrors id={`${fieldId("time")}-err`} errors={errFor("time")} />

        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted">Slip landing:</span>
          {[-7, -1, 1, 7].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onSlip(d)}
              className="rounded border border-line px-1.5 py-0.5 font-mono hover:border-sun hover:text-sun focus-visible:outline-2 focus-visible:outline-sun"
              aria-label={`Move the landing time by ${d} day${Math.abs(d) > 1 ? "s" : ""}`}
            >
              {d > 0 ? `+${d}` : d}d
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={fieldId("lat")} className={label}>
              Target latitude (°)
            </label>
            <input
              id={fieldId("lat")}
              inputMode="decimal"
              value={lat}
              placeholder="click the map"
              onChange={(e) => setLat(e.target.value)}
              className={`${input} font-mono`}
              aria-invalid={errFor("lat").length > 0}
              aria-describedby={`${fieldId("lat")}-err`}
            />
          </div>
          <div>
            <label htmlFor={fieldId("lon")} className={label}>
              Longitude (°E)
            </label>
            <input
              id={fieldId("lon")}
              inputMode="decimal"
              value={lon}
              placeholder="click the map"
              onChange={(e) => setLon(e.target.value)}
              className={`${input} font-mono`}
              aria-invalid={errFor("lon").length > 0}
              aria-describedby={`${fieldId("lat")}-err`}
            />
          </div>
        </div>
        <FieldErrors id={`${fieldId("lat")}-err`} errors={[...errFor("lat"), ...errFor("lon")]} />
        <p className="text-[11px] text-muted">
          Elevation (LOLA DEM):{" "}
          <span className="font-mono text-foreground">
            {targetElevationM === null ? "–" : `${Math.round(targetElevationM)} m`}
          </span>
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={fieldId("roi")} className={label}>
              Search area
            </label>
            <select
              id={fieldId("roi")}
              value={roiHalfKm}
              onChange={(e) => setRoiHalfKm(Number(e.target.value))}
              className={input}
            >
              {ROI_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s * 2} × {s * 2} km
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={fieldId("window")} className={label}>
              Mission window
            </label>
            <select
              id={fieldId("window")}
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              className={input}
            >
              {WINDOWS.map((w) => (
                <option key={w.days} value={w.days}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <FieldErrors
          id={`${fieldId("roi")}-err`}
          errors={[...errFor("roi"), ...errFor("window")]}
        />

        <div>
          <label htmlFor={fieldId("preset")} className={label}>
            Mission priority
          </label>
          <select
            id={fieldId("preset")}
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className={input}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="mt-0.5 text-[11px] text-muted">
            {presets.find((p) => p.id === presetId)?.description}
          </p>
        </div>
        <FieldErrors id={`${fieldId("preset")}-err`} errors={errFor("preset")} />

        <button
          type="submit"
          className="w-full rounded border border-sun/70 bg-sun/10 px-3 py-1.5 text-sm font-medium text-sun hover:bg-sun/20 focus-visible:outline-2 focus-visible:outline-sun"
        >
          Apply mission setup
        </button>
        <p className="text-[10px] text-muted">
          Sun &amp; Earth data available {toInput(coverage.startMs).slice(0, 10)} to{" "}
          {toInput(coverage.endMs).slice(0, 10)} (UTC).
        </p>
      </form>
    </Panel>
  );
}

function FieldErrors({ id, errors }: { id: string; errors: SetupError[] }) {
  return (
    <div id={id} role="alert" aria-live="polite">
      {errors.map((e) => (
        <p key={e.message} className="text-[11px] text-bad">
          ⚠ {e.message}
        </p>
      ))}
    </div>
  );
}
