import { fetchShutdowns, parseShutdownQuery } from "@/lib/shutdowns";

const cache = new Map<string, { at: number; data: Awaited<ReturnType<typeof fetchShutdowns>> }>();
export async function GET(request: Request) {
  const url = new URL(request.url);
  let input: ReturnType<typeof parseShutdownQuery>;
  try { input = parseShutdownQuery(url); }
  catch { return Response.json({ error: "Перевірте населений пункт, вулицю та будинок." }, { status: 400 }); }
  const key = JSON.stringify(input);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 60_000 && url.searchParams.get("fresh") !== "1") return Response.json(cached.data, { headers: { "Cache-Control": "no-store" } });
  try {
    const data = await fetchShutdowns(input);
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), data });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Address shutdown fetch failed:", cause instanceof Error ? cause.message : "unknown error");
    return Response.json({ error: "Не вдалося отримати відключення за адресою. Спробуйте оновити ще раз." }, { status: 502 });
  }
}
