import { z } from "zod";

export const QUEUES = Array.from({ length: 6 }, (_, i) => [`${i + 1}.1`, `${i + 1}.2`]).flat();
export const isQueue = (value: string) => QUEUES.includes(value);
export type Slot = { start: number; end: number; status: number };
export type Day = { date: string; noData: boolean; slots: Slot[] };
export type Schedule = { queue: string; fetchedAt: string; sourceUpdatedAt: string; days: Day[] };
type State = { label: string; kind: "on" | "off" | "unknown" };
// APK createTable: 1 = off; 3 uses the "є світло" fallback. no_data is separate.
const STATES: Record<number, State> = { 1: { label: "Відключення", kind: "off" }, 3: { label: "Світло є", kind: "on" } };
export function stateFor(status: number): State {
  return STATES[status] ?? { label: status === -1 ? "Немає даних" : `Невизначений стан · статус ${status}`, kind: "unknown" };
}
const rawInterval = z.object({ start_time: z.string(), end_time: z.string() });
const rawSlot = rawInterval.extend({ status: z.number().int(), cherga: z.string().optional() });
const rawDay = z.object({ date_today: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/), no_data: z.boolean(), gpv_schedule: z.array(rawSlot).max(1000), lst_time_disc: z.array(rawInterval).max(1000).nullish() });
const response = z.object({ data: rawDay.extend({ last_update: z.string().nullish(), dict_tom: rawDay.nullish(), cherga_n: z.string().nullish() }) });
export function minutes(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== "24:00") throw new Error("Некоректний час у графіку");
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
export function time(value: number): string {
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
export function duration(value: number): string {
  return [value >= 60 ? `${Math.floor(value / 60)} год` : "", value % 60 ? `${value % 60} хв` : ""].filter(Boolean).join(" ") || "0 хв";
}
export function normalizeSlots(raw: z.infer<typeof rawSlot>[], queue: string): Slot[] {
  const supplied = raw.filter(slot => !slot.cherga || slot.cherga === queue).map(slot => {
    const start = minutes(slot.start_time);
    const end = slot.end_time === "00:00" && start > 0 ? 1440 : minutes(slot.end_time);
    if (start >= end || start >= 1440) throw new Error("Некоректний інтервал у графіку");
    return { start, end, status: slot.status };
  }).sort((a, b) => a.start - b.start);
  if (raw.length && !supplied.length) throw new Error("Сервер повернув іншу чергу");
  const slots: Slot[] = [];
  let end = 0;
  for (const slot of supplied) {
    if (slot.start < end) throw new Error("Інтервали графіка перекриваються");
    if (slot.start > end) slots.push({ start: end, end: slot.start, status: -1 });
    slots.push(slot); end = slot.end;
  }
  if (end < 1440) slots.push({ start: end, end: 1440, status: -1 });
  return slots;
}
export function mergeSlots(slots: Slot[]): Slot[] {
  const merged: Slot[] = [];
  for (const slot of slots) {
    const last = merged.at(-1);
    if (last?.status === slot.status && last.end === slot.start) last.end = slot.end;
    else merged.push({ ...slot });
  }
  return merged;
}
export function parseSchedule(body: unknown, queue: string, fetchedAt = new Date().toISOString()): Schedule {
  const { data } = response.parse(body);
  if (data.cherga_n && data.cherga_n !== queue) throw new Error("Сервер повернув іншу чергу");
  return { queue, fetchedAt, sourceUpdatedAt: data.last_update || "", days: [data, data.dict_tom].filter(d => d != null).map(d => {
    let slots = normalizeSlots(d.gpv_schedule, queue);
    if (d.lst_time_disc?.length) {
      // Numeric outage times can be populated while the entire grid still has status 3.
      const outages = normalizeSlots(d.lst_time_disc.map(interval => ({ ...interval, status: 1 })), queue);
      slots = slots.flatMap(slot => outages.filter(interval => interval.start < slot.end && interval.end > slot.start).map(interval => ({
        start: Math.max(slot.start, interval.start), end: Math.min(slot.end, interval.end), status: interval.status === 1 ? 1 : slot.status,
      })));
    }
    return { date: d.date_today, noData: d.no_data, slots };
  }) };
}
export function kyivClock(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  return { date: `${part("day")}.${part("month")}.${part("year")}`, time: `${part("hour")}:${part("minute")}`, minute: Number(part("hour")) * 60 + Number(part("minute")) };
}
export function dateLabel(date: string) {
  const [day, month, year] = date.split(".");
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", timeZone: "Europe/Kyiv" }).format(new Date(`${year}-${month}-${day}T12:00:00Z`));
}
