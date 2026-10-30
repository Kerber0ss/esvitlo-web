import { isQueue, parseSchedule, type Schedule } from "@/lib/schedule";
const ENDPOINT = "https://sm.e-svitlo.com.ua/ip_cabinet/restfull_api/improvise/api_main/get_user_disconnections_image_api.json";
const cache = new Map<string, { at: number; data: Schedule }>();
export async function GET(request: Request) {
  const url = new URL(request.url);
  const queue = url.searchParams.get("queue") ?? "1.1";
  if (!isQueue(queue)) return Response.json({ error: "Оберіть чергу від 1.1 до 6.2" }, { status: 400 });
  const cached = cache.get(queue);
  if (cached && Date.now() - cached.at < 60_000 && url.searchParams.get("fresh") !== "1") return Response.json(cached.data, { headers: { "Cache-Control": "no-store" } });
  try {
    const result = await fetch(ENDPOINT, { method: "POST", body: new URLSearchParams({ cherga: queue, mobile_v: "true" }), headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000), redirect: "manual", cache: "no-store" });
    if (!result.ok) throw new Error(`E-Svitlo: HTTP ${result.status}`);
    const data = parseSchedule(await result.json(), queue);
    cache.set(queue, { at: Date.now(), data });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Schedule fetch failed:", cause instanceof Error ? cause.message : "unknown error");
    return Response.json({ error: "Не вдалося отримати графік від E-Svitlo. Спробуйте оновити ще раз." }, { status: 502 });
  }
}
