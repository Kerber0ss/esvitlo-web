import { normalizeSlots, withOutages, type Schedule } from "./schedule.ts";
import type { AddressDetails, AddressOutage } from "./shutdowns.ts";

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
