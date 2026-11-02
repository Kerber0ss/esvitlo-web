import { z } from "zod";

export const QUEUE_TYPES = ["ГАВ", "АЧР", "СГАВ", "ГПВ", "САВН", "ГОП", "ГОЕ"] as const;
export type QueueType = typeof QUEUE_TYPES[number];
export type AddressOption = { id: string; label: string };
export type AddressOutage = { city: string; street: string; house: string; start: string; end: string; typeCode: number; label: string };
export type AddressDetails = { fetchedAt: string; outages: AddressOutage[]; queues: Record<QueueType, string[]> };

const id = z.string().regex(/^[1-9]\d{0,11}$/);
const search = z.string().trim().min(1).max(100);
const query = z.discriminatedUnion("resource", [
  z.object({ resource: z.literal("cities"), search }),
  z.object({ resource: z.literal("streets"), cityId: id, search }),
  z.object({ resource: z.literal("houses"), streetId: id, search }),
  z.object({ resource: z.literal("details"), houseId: id, streetId: id }),
]);
export function parseShutdownQuery(url: URL) {
  return query.parse({ resource: url.searchParams.get("resource"), search: url.searchParams.get("search") ?? "", cityId: url.searchParams.get("cityId"), streetId: url.searchParams.get("streetId"), houseId: url.searchParams.get("houseId") });
}
const optionRow = z.tuple([z.union([z.number().int().positive().safe(), id]), z.string().min(1).max(500)]);
const listEnvelope = <T extends z.ZodTypeAny>(row: T) => z.object({ data: z.object({ result: z.literal(0), list: z.array(row).max(20_000) }) });
export function parseAddressOptions(body: unknown): AddressOption[] {
  return listEnvelope(optionRow).parse(body).data.list.map(([value, label]) => ({ id: String(value), label }));
}
function validLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && hour < 24 && minute < 60 && second < 60;
}
const localDate = z.string().refine(validLocalDate, "Некоректна дата відключення");
const outageRow = z.tuple([z.string(), z.string(), z.string(), localDate, localDate, z.number().int()]).rest(z.unknown()).refine(row => row[3] < row[4], "Некоректний інтервал відключення");
const queueRow = z.tuple([z.string(), z.string(), z.string(), z.array(z.string().nullable()).length(7)]);
// Labels follow the official site's result table; its filter uses a different numbering.
const TYPE_LABELS: Record<number, string> = { 1: "Планові роботи", 2: "Аварійне відключення", 3: "ГАВ", 4: "ГПВ", 5: "ГПВ", 6: "СГАВ", 7: "Термінові планові роботи", 8: "САВН", 9: "Аварійне відключення", 10: "ГОП" };
export function parseAddressDetails(outageBody: unknown, queueBody: unknown, fetchedAt = new Date().toISOString()): AddressDetails {
  const outages = listEnvelope(outageRow).parse(outageBody).data.list.map(([city, street, house, start, end, typeCode]) => ({ city, street, house, start, end, typeCode, label: TYPE_LABELS[typeCode] ?? `Тип відключення ${typeCode}` }));
  const rows = listEnvelope(queueRow).parse(queueBody).data.list;
  if (rows.length > 1) throw new Error("Сервер повернув декілька адрес замість одного будинку");
  if (rows[0] && outages.some(outage => outage.house !== rows[0][2])) throw new Error("Сервер повернув відключення іншого будинку");
  const queues = Object.fromEntries(QUEUE_TYPES.map((type, i) => [type, [...new Set((rows[0]?.[3][i] ?? "").split(",").map(value => value.trim()).filter(Boolean))]])) as Record<QueueType, string[]>;
  return { fetchedAt, outages, queues };
}

export async function decodeSoePayload(body: unknown, now = new Date()): Promise<unknown> {
  const { payload } = z.object({ payload: z.string().min(1).max(8_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).parse(body);
  const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
  if (bytes.length < 29) throw new Error("Неповна відповідь Сумиобленерго");
  for (const offset of [0, -1]) {
    // Reproduce the public website client, including its 32-byte key truncation.
    const material = `qasdw-enjenf-twfeft!!d451qwqw!-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${Math.floor(now.getMinutes() / 5) + offset}`.padEnd(32, "x").slice(0, 32);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(material), "AES-GCM", false, ["decrypt"]);
    try {
      const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
      return JSON.parse(new TextDecoder().decode(decoded));
    } catch (cause) { if (offset === -1) throw cause; }
  }
  throw new Error("Не вдалося прочитати відповідь Сумиобленерго");
}
async function requestSoe(resource: string, params: Record<string, string>) {
  const url = new URL(`https://www.soe.com.ua/next-api/shutdowns/${resource}`);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { headers: { Accept: "application/json", "X-Source": "soe-website", Referer: "https://www.soe.com.ua/consumers/shutdowns", Origin: "https://www.soe.com.ua", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15_000), redirect: "manual", cache: "no-store" });
  if (!response.ok) throw new Error(`Сумиобленерго: HTTP ${response.status}`);
  return decodeSoePayload(await response.json());
}
export async function fetchShutdowns(input: ReturnType<typeof parseShutdownQuery>): Promise<{ options: AddressOption[] } | AddressDetails> {
  if (input.resource === "details") {
    const [outages, queues] = await Promise.all([requestSoe("by-house", { houseId: input.houseId }), requestSoe("queues-by-street", { houseId: input.houseId, streetId: input.streetId })]);
    return parseAddressDetails(outages, queues);
  }
  const { resource, ...params } = input;
  return { options: parseAddressOptions(await requestSoe(resource, params)) };
}
