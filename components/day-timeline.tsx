"use client";
import { Info, Unplug } from "lucide-react";
import { duration, stateFor, time, type Slot } from "@/lib/schedule";
import type { TimelineSlot } from "@/lib/address-schedule";

export type Clock = { date: string; time: string; minute: number } | null;

/** Two 12-hour rows with the now marker. `neutral` paints "no data" as plain background: address-only view. */
export function DayTimeline({ slots, clock, isToday, selected, onSelect, neutral = false }: { slots: TimelineSlot[]; clock: Clock; isToday: boolean; selected: TimelineSlot | null; onSelect: (slot: TimelineSlot) => void; neutral?: boolean }) {
  const dot = (slot: TimelineSlot) => slot.outageKind === "overlap" ? "overlap" : slot.outageKind === "address" ? "address" : neutral && stateFor(slot.status).kind === "unknown" ? "idle" : stateFor(slot.status).kind;
  return <>
    {[0, 720].map(start => <div className="timeline-row" key={start}>
      <div className="timeline-track">
        {slots.filter(slot => slot.start < start + 720 && slot.end > start).map(slot => {
          const state = stateFor(slot.status);
          const kind = neutral && state.kind === "unknown" ? "idle" : state.kind;
          const left = Math.max(start, slot.start);
          const right = Math.min(start + 720, slot.end);
          const label = slot.causes.join(" + ") || state.label;
          return <button
            key={`${slot.start}-${slot.end}`}
            type="button"
            className={`timeline-block ${kind} ${slot.outageKind ? `outage-${slot.outageKind}` : ""} ${selected?.start === slot.start && selected?.end === slot.end ? "selected" : ""}`}
            style={{ flexGrow: right - left, flexBasis: 0 }}
            aria-label={`${time(slot.start)}–${time(slot.end)}: ${label}`}
            title={`${time(slot.start)}–${time(slot.end)} · ${label}`}
            onClick={() => onSelect(slot)}
          ><span className="sr-only">{label}</span></button>;
        })}
        {isToday && clock && clock.minute >= start && clock.minute < start + 720 &&
          <div className="now-marker" style={{ left: `${(clock.minute - start) / 720 * 100}%` }} aria-label={`Зараз ${clock.time}`}><span>зараз</span><i /></div>}
      </div>
      <div className="timeline-ticks">{Array.from({ length: 7 }, (_, i) => <span key={i}>{time(start + i * 120)}</span>)}</div>
    </div>)}
    <div className="timeline-detail" aria-live="polite">
      {selected
        ? <><i className={`legend-dot ${dot(selected)}`} /><strong>{time(selected.start)} — {time(selected.end)}</strong><span>{selected.causes.join(" + ") || stateFor(selected.status).label}</span><em>{duration(selected.end - selected.start)}</em></>
        : <><Info size={14} /><span>Натисни на інтервал, щоб побачити всі причини відключення.</span></>}
    </div>
  </>;
}

export function OutageList({ outages, clock, isToday, causesFor }: { outages: Slot[]; clock: Clock; isToday: boolean; causesFor?: (start: number, end: number) => string }) {
  const active = (slot: Slot) => isToday && !!clock && clock.minute >= slot.start && clock.minute < slot.end;
  const past = (slot: Slot) => isToday && !!clock && clock.minute >= slot.end;
  return <div className="outage-list">{outages.map((slot, index) => <div className={`outage-row ${causesFor ? "with-causes" : ""} ${active(slot) ? "current-outage" : ""}`} key={slot.start}>
    <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
    <Unplug size={19} />
    <strong>{time(slot.start)} <span>—</span> {time(slot.end)}</strong>
    <span className="outage-duration">{duration(slot.end - slot.start)}</span>
    <span className="row-state">{active(slot) ? "триває зараз" : past(slot) ? "минуло" : "за графіком"}</span>
    {causesFor && <span className="outage-causes">{causesFor(slot.start, slot.end)}</span>}
  </div>)}</div>;
}
