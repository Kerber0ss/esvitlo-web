"use client";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Clock3, Info, Moon, RefreshCw, Sun, Unplug, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { QUEUES, dateLabel, duration, isQueue, kyivClock, mergeSlots, stateFor, time, type Schedule, type Slot } from "@/lib/schedule";

export default function Home() {
  const [queue, setQueue] = useState("1.1");
  const [ready, setReady] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(0);
  const [selected, setSelected] = useState<Slot | null>(null);
  useEffect(() => {
    try { const saved = localStorage.getItem("svitlo.queue"); if (saved && isQueue(saved)) setQueue(saved); } catch { /* Storage is optional. */ }
    setReady(true); setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    const reload = setInterval(() => setRefresh(value => value + 1), 300_000);
    return () => { clearInterval(clock); clearInterval(reload); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setSelected(null);
    try { localStorage.setItem("svitlo.queue", queue); } catch { /* Storage is optional. */ }
    fetch(`/api/schedule?queue=${encodeURIComponent(queue)}${refresh ? "&fresh=1" : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const body = await response.json() as Schedule & { error?: string };
        if (!response.ok) throw new Error(body.error || "Не вдалося завантажити графік");
        if (!controller.signal.aborted) setSchedule(body);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [queue, ready, refresh]);

  const data = schedule?.queue === queue ? schedule : null;
  const day = data?.days[dayIndex] ?? data?.days[0];
  const clock = now ? kyivClock(now) : null;
  const isToday = clock?.date === day?.date;
  const current = isToday ? day?.slots.find(slot => slot.start <= clock!.minute && slot.end > clock!.minute) : null;
  const currentState = current ? stateFor(current.status) : null;
  const merged = mergeSlots(day?.slots ?? []);
  const outages = merged.filter(slot => stateFor(slot.status).kind === "off");
  const total = (kind: string) => (day?.slots ?? []).filter(slot => stateFor(slot.status).kind === kind).reduce((sum, slot) => sum + slot.end - slot.start, 0);
  const nextOutage = isToday ? outages.find(slot => slot.start > clock!.minute) : null;
  const unknown = total("unknown");
  const updated = data && kyivClock(Date.parse(data.fetchedAt)).time;
  const sourceIsToday = data?.days[0].date === clock?.date;

  return <div className="site-shell">
    <header className="site-header">
      <a href="/" className="brand" aria-label="Світло — головна"><span className="brand-mark"><Zap size={21} fill="currentColor" /></span>світло<span className="brand-city">суми</span></a>
      <div className="header-right"><span className="live-dot" />Дані E-Svitlo<span className="header-divider" /><span>Сумиобленерго</span></div>
    </header>
    <main>
      <section className="intro">
        <div><div className="eyebrow">ТВІЙ ДЕНЬ · ТВОЯ ЧЕРГА</div><h1>Коли буде світло<span>?</span></h1><p>Графік під рукою. Плануй важливе у зручний час.</p></div>
        <div className="queue-picker"><label htmlFor="queue">Моя черга</label><NativeSelect id="queue" value={queue} onChange={event => { setQueue(event.target.value); setDayIndex(0); }} className="queue-select">{QUEUES.map(value => <option key={value} value={value}>Черга {value}</option>)}</NativeSelect><span className="saved-hint"><Check size={12} /> Запам’ятаємо твій вибір</span></div>
      </section>
      <section className="dashboard" aria-label="Графік відключень">
        <div className="dashboard-toolbar">
          <div className="date-tabs" role="tablist" aria-label="День графіка">{[0, 1].map(index => <Button key={index} id={`day-tab-${index}`} role="tab" aria-controls="day-panel" aria-selected={dayIndex === index} tabIndex={dayIndex === index ? 0 : -1} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const target = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index; if (target === 0 || data?.days[1]) { setDayIndex(target); setSelected(null); document.getElementById(`day-tab-${target}`)?.focus(); } } }} variant="ghost" disabled={index === 1 && !data?.days[1]} className={`date-tab ${dayIndex === index ? "active" : ""}`} onClick={() => { setDayIndex(index); setSelected(null); }}><span>{index === 0 ? <Sun size={17} /> : <Moon size={17} />}{index === 0 ? (sourceIsToday || !data ? "Сьогодні" : "Дата джерела") : (sourceIsToday ? "Завтра" : "Наступний день")}</span><small>{data?.days[index] ? dateLabel(data.days[index].date) : "—"}</small></Button>)}</div>
          <div className="refresh-area"><span className="updated-time">{loading ? "Отримуємо дані…" : updated ? `Перевірено о ${updated}` : ""}</span><Button variant="outline" size="icon" onClick={() => setRefresh(value => value + 1)} disabled={loading} aria-label="Оновити графік" title="Оновити графік" className="refresh-button"><RefreshCw size={17} className={loading ? "spinning" : ""} /></Button></div>
        </div>
        {error && <div className="error-banner" role="alert"><Info size={19} /><span>{error}{data ? " Показано попередню відповідь; вона може бути застарілою." : ""}</span><Button variant="ghost" onClick={() => setRefresh(value => value + 1)}>Повторити <ArrowRight size={15} /></Button></div>}
        {!data && loading ? <div className="loading-state" role="status"><span className="loading-orbit"><Zap size={26} /></span><h2>Отримуємо графік для черги {queue}</h2><p>Звертаємося до E-Svitlo…</p><div className="loading-bars">{Array.from({ length: 24 }, (_, i) => <i key={i} />)}</div></div> : day && <div id="day-panel" role="tabpanel" aria-labelledby={`day-tab-${dayIndex}`} aria-busy={loading} className={loading ? "day-content refreshing" : "day-content"}>
          {day.noData && <div className="source-notice"><Info size={17} /><p><strong>Графік не підтверджено джерелом.</strong> Показуємо всі отримані інтервали, але E-Svitlo повертає «немає опублікованого графіка». Зелені інтервали не гарантують наявності світла.</p></div>}
          <div className={`status-overview ${currentState?.kind ?? "unknown"}`}>
            <div className="status-icon">{currentState?.kind === "on" ? <Zap size={26} /> : currentState?.kind === "off" ? <Unplug size={26} /> : <Clock3 size={26} />}</div>
            <div className="status-copy"><span className="eyebrow">{day.noData ? "ЗА НЕПІДТВЕРДЖЕНИМИ ІНТЕРВАЛАМИ" : isToday ? "ЗАРАЗ ЗА ГРАФІКОМ" : `ГРАФІК НА ${dateLabel(day.date).toUpperCase()}`}</span><h2>{currentState?.label ?? `Графік черги ${queue}`}</h2><p>{currentState?.kind === "off" && current ? `Поточний інтервал до ${time(current.end)}` : nextOutage ? `Наступне відключення о ${time(nextOutage.start)}` : "Інтервали джерела — на часовій шкалі нижче."}</p></div>
            <div className="kyiv-clock"><span>{clock?.time ?? "—:—"}</span><small>час у Києві</small></div>
          </div>
          <div className="summary-grid">
            <div className="summary-item"><span><i className="legend-dot off" />Без світла</span><strong>{unknown === 1440 ? "—" : duration(total("off"))}</strong><small>{outages.length ? `${outages.length} інтервалів за добу` : "за отриманими інтервалами"}</small></div>
            <div className="summary-item"><span><i className="legend-dot on" />Зі світлом</span><strong>{unknown === 1440 ? "—" : duration(total("on"))}</strong><small>{day.noData ? "джерело не підтверджує графік" : "за отриманим графіком"}</small></div>
            <div className="summary-item"><span><i className="legend-dot unknown" />Невизначений стан</span><strong>{duration(unknown)}</strong><small>відсутній або невідомий статус</small></div>
          </div>
          <section className="timeline-section" aria-labelledby="timeline-title">
            <div className="section-heading"><div><h2 id="timeline-title">Світло протягом дня</h2><p>{dateLabel(day.date)} · черга {queue}</p></div><span className="time-zone"><Clock3 size={13} /> Київ, 24-годинний формат</span></div>
            <div className="legend"><span><i className="legend-dot on" />Світло є</span><span><i className="legend-dot off" />Відключення</span><span><i className="legend-dot unknown" />Невизначений стан</span></div>
            {[0, 720].map(start => <div className="timeline-row" key={start}><div className="timeline-track">
              {day.slots.filter(slot => slot.start < start + 720 && slot.end > start).map(slot => {
                const state = stateFor(slot.status); const left = Math.max(start, slot.start); const right = Math.min(start + 720, slot.end);
                return <button key={`${slot.start}-${slot.end}`} type="button" className={`timeline-block ${state.kind} ${selected?.start === slot.start ? "selected" : ""}`} style={{ flexGrow: right - left, flexBasis: 0 }} aria-label={`${time(slot.start)}–${time(slot.end)}: ${state.label}, статус ${slot.status}`} title={`${time(slot.start)}–${time(slot.end)} · ${state.label} · статус ${slot.status}`} onClick={() => setSelected(slot)}><span className="sr-only">{state.label}</span></button>;
              })}
              {isToday && clock && clock.minute >= start && clock.minute < start + 720 && <div className="now-marker" style={{ left: `${(clock.minute - start) / 720 * 100}%` }} aria-label={`Зараз ${clock.time}`}><span>зараз</span><i /></div>}
            </div><div className="timeline-ticks">{Array.from({ length: 7 }, (_, i) => <span key={i}>{time(start + i * 120)}</span>)}</div></div>)}
            <div className="timeline-detail" aria-live="polite">{selected ? <><i className={`legend-dot ${stateFor(selected.status).kind}`} /><strong>{time(selected.start)} — {time(selected.end)}</strong><span>{stateFor(selected.status).label} <small>· статус {selected.status}</small></span></> : <><Info size={14} /><span>Натисни на інтервал, щоб побачити деталі.</span></>}</div>
          </section>
          <section className="interval-section" aria-labelledby="interval-title"><div className="section-heading"><div><h2 id="interval-title">Коли вимикатимуть світло</h2><p>Сусідні інтервали відключень об’єднано</p></div><span className="interval-count">{outages.length} інтервалів</span></div>
            {outages.length ? <div className="outage-list">{outages.map((slot, i) => <div className={`outage-row ${isToday && clock!.minute >= slot.start && clock!.minute < slot.end ? "current-outage" : ""}`} key={slot.start}><span className="row-index">{String(i + 1).padStart(2, "0")}</span><Unplug size={19} /><strong>{time(slot.start)} <span>—</span> {time(slot.end)}</strong><span className="outage-duration">{duration(slot.end - slot.start)}</span><span className="row-state">{isToday && clock!.minute >= slot.start && clock!.minute < slot.end ? "триває зараз" : isToday && clock!.minute >= slot.end ? "минуло" : "за графіком"}</span></div>)}</div> : <div className="empty-outages"><span className="empty-icon">{unknown ? <Clock3 size={25} /> : <Zap size={25} />}</span><div><h3>{unknown ? "Час відключень не визначено" : "Відключень у відповіді не зазначено"}</h3><p>{day.noData ? "Це непідтверджені дані, а не гарантія безперервного електропостачання." : unknown ? "Невизначені інтервали не вважаємо часом зі світлом." : "У доступних інтервалах немає статусу відключення."}</p></div></div>}
          </section>
          <details className="all-intervals" open={outages.length === 0}><summary><span>Усі інтервали з відповіді <small>{day.slots.filter(slot => slot.status !== -1).length}</small></span><ChevronDown size={16} /></summary><div className="all-intervals-grid">{merged.map(slot => <div key={slot.start}><i className={`legend-dot ${stateFor(slot.status).kind}`} /><strong>{time(slot.start)} — {time(slot.end)}</strong><span>{stateFor(slot.status).label}</span><small>{slot.status === -1 ? "не надано джерелом" : `статус ${slot.status}`}</small></div>)}</div></details>
        </div>}
      </section>
      <footer className="site-footer"><p><span className="live-dot" />Автооновлення кожні 5 хвилин</p><a href="https://sm.e-svitlo.com.ua/" target="_blank" rel="noopener noreferrer">Джерело: E-Svitlo <ArrowUpRight size={14} /></a><p>Графік може змінюватись протягом дня</p></footer>
    </main>
  </div>;
}
