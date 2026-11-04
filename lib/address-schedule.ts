import { normalizeSlots, withOutages, type Schedule, type Slot } from "./schedule.ts";
import type { AddressDetails, AddressOutage } from "./shutdowns.ts";

export type TimelineSlot = Slot & { causes: string[]; outageKind: "gpv" | "address" | "overlap" | null };

export function outageOnDate(outage: AddressOutage, date: string) {
  const target = date.split(".").reverse().join("-");
  if (outage.start.slice(0, 10) > target || outage.end.slice(0, 10) < target) return null;
  const minute = (value: string) => Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
  const start = outage.start.slice(0, 10) < target ? 0 : minute(outage.start);
  const end = outage.end.slice(0, 10) > target ? 1440 : minute(outage.end);
  return start < end ? { start, end } : null;
}

export function addressDaySlots(details: AddressDetails, schedule: Schedule | null, date: string) {
  const gpv = schedule && details.queues["ГПВ"].includes(schedule.queue) ? schedule.days.find(day => day.date === date) : null;
  const windows = details.outages.flatMap(outage => {
    const interval = outageOnDate(outage, date);
    return interval ? [interval] : [];
  });
  return withOutages(gpv?.slots ?? normalizeSlots([], ""), windows);
}

export function addressDayTimeline(details: AddressDetails, schedule: Schedule | null, date: string): TimelineSlot[] {
  const gpv = schedule && details.queues["ГПВ"].includes(schedule.queue) ? schedule.days.find(day => day.date === date) : null;
  return addressDaySlots(details, schedule, date).map(slot => {
    const gpvOff = !!gpv?.slots.some(interval => interval.start <= slot.start && interval.end > slot.start && interval.status === 1);
    const addressCauses = details.outages.filter(outage => {
      const interval = outageOnDate(outage, date);
      return interval && interval.start <= slot.start && interval.end > slot.start;
    }).map(outage => outage.label);
    const causes = [...new Set([...(gpvOff ? [`ГПВ ${schedule!.queue}`] : []), ...addressCauses])];
    return { ...slot, causes, outageKind: causes.length > 1 ? "overlap" : gpvOff ? "gpv" : addressCauses.length ? "address" : null };
  });
}
