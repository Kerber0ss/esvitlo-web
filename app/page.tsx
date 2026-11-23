"use client";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Clock3, Info, Layers, ListOrdered, MapPin, Moon, RefreshCw, Sun, Unplug, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { AddressPicker, type AddressStatus } from "@/components/address-picker";
import { DayTimeline, OutageList } from "@/components/day-timeline";
import { addressDayTimeline, type TimelineSlot } from "@/lib/address-schedule";
import { QUEUES, dateLabel, duration, isQueue, kyivClock, mergeSlots, stateFor, time, type Schedule } from "@/lib/schedule";

type Mode = "address" | "queue" | "combined";
const MODES = [
  { id: "address" as const, label: "Моя адреса", hint: "відключення будинку", Icon: MapPin },
  { id: "queue" as const, label: "Черги ГПВ", hint: "графік по області", Icon: ListOrdered },
  { id: "combined" as const, label: "Разом", hint: "адреса + черга", Icon: Layers },
];
const isMode = (value: string | null): value is Mode => MODES.some(mode => mode.id === value);
const QUEUE_TYPES = ["ГПВ", "ГАВ", "СГАВ", "АЧР"] as const;

export default function Home() {
  const [mode, setMode] = useState<Mode>("address");
  const [queue, setQueue] = useState("1.1");
  const [editingQueue, setEditingQueue] = useState(false);
  const [ready, setReady] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(0);
  const [selected, setSelected] = useState<TimelineSlot | null>(null);
  const [address, setAddress] = useState<AddressStatus>({ details: null, selected: false, label: "", loading: false, error: "" });
  useEffect(() => {
    try {
      const saved = localStorage.getItem("svitlo.queue"); if (saved && isQueue(saved)) setQueue(saved);
      const savedMode = localStorage.getItem("svitlo.mode"); if (isMode(savedMode)) setMode(savedMode);
    } catch { /* Storage is optional. */ }
    setReady(true); setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    const reload = setInterval(() => setRefresh(value => value + 1), 300_000);
    return () => { clearInterval(clock); clearInterval(reload); };
  }, []);
  useEffect(() => { try { localStorage.setItem("svitlo.mode", mode); } catch { /* Storage is optional. */ } }, [mode]);
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
  const clock = now ? kyivClock(now) : null;
  const dayDate = (offset: number) => clock ? kyivClock(Date.parse(`${clock.date.split(".").reverse().join("-")}T12:00:00Z`) + offset * 86_400_000).date : "";
  const calendarDates = [dayDate(0), dayDate(1)];
  const queueMode = mode === "queue";
  const showCombined = mode === "combined";
  const tabDates = queueMode && data ? data.days.map(day => day.date) : calendarDates;
  const firstIsToday = !clock || tabDates[0] === clock.date;
  const activeDay = tabDates[1] || dayIndex === 0 ? dayIndex : 0;
  const busy = loading || address.loading;
  const updatedAt = queueMode ? data?.fetchedAt : address.details?.fetchedAt ?? data?.fetchedAt;
  const updated = updatedAt ? kyivClock(Date.parse(updatedAt)).time : "";

  // ── адреса: тільки те, що стосується будинку ──
  const addressDate = calendarDates[activeDay] ?? "";
  const addressSlots: TimelineSlot[] = address.details && clock && addressDate ? addressDayTimeline(address.details, null, addressDate) : [];
  const addressOff = mergeSlots(addressSlots).filter(slot => stateFor(slot.status).kind === "off");
  const addressIsToday = !!clock && clock.date === addressDate;
  const addressCurrent = addressIsToday && clock ? addressOff.find(slot => slot.start <= clock.minute && slot.end > clock.minute) ?? null : null;
  const addressNext = addressIsToday && clock ? addressOff.find(slot => slot.start > clock.minute) ?? null : addressOff[0] ?? null;
  const addressTotal = addressOff.reduce((sum, slot) => sum + slot.end - slot.start, 0);
  const addressCause = (start: number, end: number) => [...new Set(addressSlots.filter(slot => slot.start < end && slot.end > start).flatMap(slot => slot.causes))].join(" + ");
  const houseQueues = address.details?.queues["ГПВ"] ?? [];
  const queueMatches = houseQueues.includes(queue);
  const selectQueue = (value: string) => {
    setQueue(value);
    setDayIndex(0);
    setEditingQueue(false);
  };

  // ── черги: графік ГПВ, за потреби разом з адресою ──
  const queueDay = data ? (showCombined ? data.days.find(day => day.date === calendarDates[activeDay]) : data.days[activeDay] ?? data.days[0]) ?? null : null;
  const day = queueDay ?? (showCombined && address.details && calendarDates[activeDay] ? { date: calendarDates[activeDay], noData: true, slots: [] } : null);
  const dayIsToday = !!clock && clock.date === day?.date;
  useEffect(() => setSelected(null), [address.details, day?.date]);
  const gpvUnconfirmed = !!queueDay?.noData && (!showCombined || queueMatches);
  const slots: TimelineSlot[] = day ? showCombined && address.details ? addressDayTimeline(address.details, data, day.date) : day.slots.map(slot => ({ ...slot, causes: slot.status === 1 ? [`ГПВ ${queue}`] : [], outageKind: slot.status === 1 ? "gpv" : null })) : [];
  const merged = mergeSlots(slots);
  const current = dayIsToday && clock ? merged.find(slot => slot.start <= clock.minute && slot.end > clock.minute) ?? null : null;
  const currentState = current ? stateFor(current.status) : null;
  const outages = merged.filter(slot => stateFor(slot.status).kind === "off");
  const total = (kind: string) => slots.filter(slot => stateFor(slot.status).kind === kind).reduce((sum, slot) => sum + slot.end - slot.start, 0);
  const causesFor = (start: number, end: number) => [...new Set(slots.filter(slot => slot.start < end && slot.end > start).flatMap(slot => slot.causes))].join(" + ");
  const nextOutage = dayIsToday && clock ? outages.find(slot => slot.start > clock.minute) ?? null : null;
  const unknown = total("unknown");

  const dayTabs = [0, 1].map(index => {
    const label = index === 0 ? (firstIsToday ? "Сьогодні" : "Дата джерела") : (firstIsToday ? "Завтра" : "Наступний день");
    return <Button
      key={index}
      id={`day-tab-${index}`}
      role="tab"
      aria-controls="day-panel"
      aria-selected={activeDay === index}
      tabIndex={activeDay === index ? 0 : -1}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
        if (target === 0 || tabDates[1]) { setDayIndex(target); setSelected(null); document.getElementById(`day-tab-${target}`)?.focus(); }
      }}
      variant="ghost"
      disabled={index === 1 && !tabDates[1]}
      className={`date-tab ${activeDay === index ? "active" : ""}`}
      onClick={() => { setDayIndex(index); setSelected(null); }}
    ><span>{index === 0 ? <Sun size={17} /> : <Moon size={17} />}{label}</span><small>{tabDates[index] ? dateLabel(tabDates[index]) : "—"}</small></Button>;
  });

  const addressPanel = address.details && clock
    ? <>
      <div className={`status-overview ${addressCurrent ? "off" : "on"}`}>
        <div className="status-icon">{addressCurrent ? <Unplug size={26} /> : <Zap size={26} />}</div>
        <div className="status-copy">
          <span className="eyebrow">{addressIsToday ? "ЗАРАЗ ЗА АДРЕСОЮ" : `АДРЕСА НА ${dateLabel(addressDate).toUpperCase()}`}</span>
          <h2>{addressCurrent ? "Відключення" : addressIsToday ? "Зараз відключень немає" : addressOff.length ? "Відключення за адресою" : "Відключень не заявлено"}</h2>
          <p>{addressCurrent
            ? `До ${time(addressCurrent.end)}${addressCause(addressCurrent.start, addressCurrent.end) ? ` · ${addressCause(addressCurrent.start, addressCurrent.end)}` : ""}`
            : addressNext ? `${addressIsToday ? "Наступне" : "Перше"} о ${time(addressNext.start)}–${time(addressNext.end)}`
              : "Дані ЛК Сумиобленерго за цей день"}</p>
        </div>
        <div className="kyiv-clock"><span>{clock.time}</span><small>час у Києві</small></div>
      </div>
      <div className="address-facts">
        <div className="address-fact"><span>Без світла за добу</span><strong>{addressOff.length ? duration(addressTotal) : "0 хв"}</strong></div>
        <div className="address-fact"><span>Інтервалів</span><strong>{addressOff.length}</strong></div>
        <div className="address-fact"><span>{addressIsToday ? "Наступне" : "Перше"}</span><strong>{addressNext ? time(addressNext.start) : "—"}</strong></div>
      </div>
      <section className="timeline-section" aria-labelledby="address-timeline-title">
        <div className="section-heading">
          <div><h2 id="address-timeline-title">Відключення за адресою</h2><p>{dateLabel(addressDate)} · {address.label}</p></div>
          <span className="time-zone"><Clock3 size={13} /> Київ, 24-годинний формат</span>
        </div>
        <div className="legend">
          <span><i className="legend-dot idle" />Без відключень за адресою</span>
          <span><i className="legend-dot address" />Ремонт / аварія</span>
        </div>
        <DayTimeline slots={addressSlots} clock={clock} isToday={addressIsToday} selected={selected} onSelect={setSelected} neutral />
      </section>
      <section className="interval-section" aria-labelledby="address-list-title">
        <div className="section-heading">
          <div><h2 id="address-list-title">Інтервали за адресою</h2><p>Тільки відключення цього будинку, без графіків по області</p></div>
          <span className="interval-count">{addressOff.length} інтервалів</span>
        </div>
        {addressOff.length
          ? <OutageList outages={addressOff} clock={clock} isToday={addressIsToday} causesFor={addressCause} />
          : <div className="empty-outages">
            <span className="empty-icon"><Zap size={25} /></span>
            <div>
              <h3>{addressIsToday ? "На сьогодні відключень за адресою немає" : "На цей день відключень не заявлено"}</h3>
              <p>Це офіційні дані Сумиобленерго для будинку. Якщо світла немає, а тут порожньо — перевір «Черги ГПВ» або повідом про аварію.</p>
            </div>
          </div>}
      </section>
      <details className="all-intervals address-queues-details">
        <summary><span>Номери черг за адресою <small>{houseQueues.join(", ") || "не вказано"}</small></span><ChevronDown size={16} /></summary>
        <div className="address-queues">{QUEUE_TYPES.map(type => <div key={type}><span>{type}</span><strong>{address.details!.queues[type].join(", ") || "—"}</strong></div>)}</div>
        <p className="address-caption">Номер черги не означає, що графік застосовано до міста. ГПВ публікується для всієї області — порівняй його з адресою.</p>
        <div className="address-actions">
          <Button variant="outline" size="sm" onClick={() => { setMode("combined"); setSelected(null); }}>Адреса + черга на одній шкалі <ArrowRight size={15} /></Button>
          <a className="address-source" href="https://www.soe.com.ua/consumers/shutdowns" target="_blank" rel="noopener noreferrer">Джерело: Сумиобленерго <ArrowUpRight size={14} /></a>
        </div>
      </details>
    </>
    : <div className="empty-outages address-empty">
      <span className="empty-icon"><MapPin size={25} /></span>
      <div>
        <h3>Спочатку вкажи адресу</h3>
        <p>Обери населений пункт, вулицю та будинок — покажемо актуальні відключення саме для них. Це перше, на що варто дивитися: графіки по чергах публікуються для всієї області й часто не діють у місті.</p>
      </div>
    </div>;

  const queuePanel = !day && loading
    ? <div className="loading-state" role="status">
      <span className="loading-orbit"><Zap size={26} /></span>
      <h2>Отримуємо графік для черги {queue}</h2>
      <p>Звертаємося до E-Svitlo…</p>
      <div className="loading-bars">{Array.from({ length: 24 }, (_, i) => <i key={i} />)}</div>
    </div>
    : day ? <div id="day-panel" role="tabpanel" aria-labelledby={`day-tab-${activeDay}`} aria-busy={busy} className={busy ? "day-content refreshing" : "day-content"}>
      {queueMode && <div className="source-notice"><Info size={17} /><p><strong>Це графік по області.</strong> ГПВ публікується для всієї Сумської області, тому опубліковані інтервали не завжди діють у конкретному місті. Точні відключення — на вкладці «Моя адреса».</p></div>}
      {showCombined && !address.details && <div className="source-notice"><Info size={17} /><p><strong>Адресу не вказано.</strong> Показано лише ГПВ. Додай будинок вище, щоб побачити обидва джерела на одній шкалі.</p></div>}
      {gpvUnconfirmed && <div className="source-notice"><Info size={17} /><p><strong>ГПВ не підтверджено джерелом.</strong> Показуємо всі отримані інтервали, але E-Svitlo повертає «немає опублікованого графіка». Жовті інтервали не гарантують наявності світла.</p></div>}
      {queueMode && address.selected && !showCombined && <div className="source-notice"><Info size={17} /><p>{address.loading ? "Завантажуємо адресні відключення. Поки показано лише ГПВ." : "Адресні відключення не отримано. Показано лише ГПВ; загальний час може бути більшим."}</p></div>}
      {showCombined && address.details && !queueMatches && <div className="source-notice"><Info size={17} /><p>Обрана черга ГПВ не відповідає цьому будинку. Показано адресні відключення; решта часу — невизначений стан. Обери чергу будинку в блоці адреси вище.</p></div>}
      {showCombined && address.details && queueMatches && !queueDay && <div className="source-notice"><Info size={17} /><p>ГПВ на цю дату не отримано. Показано адресні відключення; решта часу — невизначений стан.</p></div>}
      <div className={`status-overview ${currentState?.kind ?? "unknown"}`}>
        <div className="status-icon">{currentState?.kind === "on" ? <Zap size={26} /> : currentState?.kind === "off" ? <Unplug size={26} /> : <Clock3 size={26} />}</div>
        <div className="status-copy">
          <span className="eyebrow">{showCombined ? (queueMatches ? "ГПВ ТА АДРЕСНІ ВІДКЛЮЧЕННЯ" : "АДРЕСНІ ВІДКЛЮЧЕННЯ") : gpvUnconfirmed ? "ЗА НЕПІДТВЕРДЖЕНИМИ ІНТЕРВАЛАМИ ГПВ" : dayIsToday ? "ЗАРАЗ ЗА ГПВ" : `ГПВ НА ${dateLabel(day.date).toUpperCase()}`}</span>
          <h2>{currentState?.label ?? (showCombined ? "Загальний графік" : `Графік черги ${queue}`)}</h2>
          <p>{currentState?.kind === "off" && current ? `Поточний інтервал до ${time(current.end)}` : nextOutage ? `Наступне відключення о ${time(nextOutage.start)}` : "Усі отримані інтервали — на часовій шкалі нижче."}</p>
        </div>
        <div className="kyiv-clock"><span>{clock?.time ?? "—:—"}</span><small>час у Києві</small></div>
      </div>
      <div className="summary-grid">
        <div className="summary-item"><span><i className="legend-dot off" />Без світла</span><strong>{unknown === 1440 ? "—" : duration(total("off"))}</strong><small>{outages.length ? `${outages.length} інтервалів за добу` : "за отриманими інтервалами"}</small></div>
        <div className="summary-item"><span><i className="legend-dot on" />Зі світлом</span><strong>{unknown === 1440 ? "—" : duration(total("on"))}</strong><small>{gpvUnconfirmed ? "джерело не підтверджує ГПВ" : "за отриманим графіком"}</small></div>
        <div className="summary-item"><span><i className="legend-dot unknown" />Невизначений стан</span><strong>{duration(unknown)}</strong><small>відсутній або невідомий статус</small></div>
      </div>
      <section className="timeline-section" aria-labelledby="timeline-title">
        <div className="section-heading">
          <div><h2 id="timeline-title">{showCombined ? "Загальний графік відключень" : "ГПВ протягом дня"}</h2><p>{dateLabel(day.date)} · {showCombined ? address.label : `черга ${queue}`}</p></div>
          <span className="time-zone"><Clock3 size={13} /> Київ, 24-годинний формат</span>
        </div>
        <div className="legend">
          <span><i className="legend-dot on" />Світло за ГПВ</span>
          <span><i className="legend-dot off" />ГПВ</span>
          {showCombined && <><span><i className="legend-dot address" />Ремонт / аварія</span><span><i className="legend-dot overlap" />Перетин відключень</span></>}
          <span><i className="legend-dot unknown" />Невизначений стан</span>
        </div>
        <DayTimeline slots={slots} clock={clock} isToday={dayIsToday} selected={selected} onSelect={setSelected} />
      </section>
      <section className="interval-section" aria-labelledby="interval-title">
        <div className="section-heading">
          <div><h2 id="interval-title">{showCombined ? "Усі відключення разом" : "Відключення за ГПВ"}</h2><p>Сусідні та перехресні інтервали об’єднано, час рахується один раз</p></div>
          <span className="interval-count">{outages.length} інтервалів</span>
        </div>
        {outages.length
          ? <OutageList outages={outages} clock={clock} isToday={dayIsToday} causesFor={showCombined ? causesFor : undefined} />
          : <div className="empty-outages">
            <span className="empty-icon">{unknown ? <Clock3 size={25} /> : <Zap size={25} />}</span>
            <div>
              <h3>{unknown ? "Час відключень не визначено" : "Відключень у відповіді не зазначено"}</h3>
              <p>{gpvUnconfirmed ? "Це непідтверджені дані, а не гарантія безперервного електропостачання." : unknown ? "Невизначені інтервали не вважаємо часом зі світлом." : "У доступних інтервалах немає статусу відключення."}</p>
            </div>
          </div>}
      </section>
      <details className="all-intervals" open={outages.length === 0}>
        <summary><span>Усі інтервали <small>{merged.length}</small></span><ChevronDown size={16} /></summary>
        <div className="all-intervals-grid">{merged.map(slot => <div key={slot.start}><i className={`legend-dot ${stateFor(slot.status).kind}`} /><strong>{time(slot.start)} — {time(slot.end)}</strong><span>{causesFor(slot.start, slot.end) || stateFor(slot.status).label}</span></div>)}</div>
      </details>
    </div>
    : <div className="empty-outages"><span className="empty-icon"><Info size={25} /></span><div><h3>Графік недоступний</h3><p>Онови сторінку або спробуй іншу чергу.</p></div></div>;

  return <div className="site-shell">
    <header className="site-header">
      <a href="/" className="brand" aria-label="Світло — головна"><span className="brand-mark"><Zap size={21} fill="currentColor" /></span>світло<span className="brand-city">суми</span></a>
      <div className="header-right"><span className="live-dot" />Дані E-Svitlo<span className="header-divider" /><span>Сумиобленерго</span></div>
    </header>
    <main>
      <section className="intro">
        <div>
          <div className="eyebrow">ТВОЯ АДРЕСА · ТВОЯ ЧЕРГА</div>
          <h1>Коли буде світло<span>?</span></h1>
          <p>Спочатку — реальні відключення твого будинку. Окремо — графіки ГПВ по області.</p>
        </div>
      </section>
      <nav className="mode-tabs" role="tablist" aria-label="Що показувати">
        {MODES.map(({ id, label, hint, Icon }) => <button key={id} type="button" role="tab" aria-selected={mode === id} className={`mode-tab ${mode === id ? "active" : ""}`} onClick={() => { setMode(id); setSelected(null); }}>
          <Icon size={17} /><span>{label}<small>{hint}</small></span>
        </button>)}
      </nav>
      <section className="dashboard" aria-label="Ситуація зі світлом">
        <div className="dashboard-toolbar">
          <div className="date-tabs" role="tablist" aria-label="День графіка">{dayTabs}</div>
          <div className="refresh-area">
            <span className="updated-time">{busy ? "Отримуємо дані…" : updated ? `Перевірено о ${updated}` : ""}</span>
            <Button variant="outline" size="icon" onClick={() => setRefresh(value => value + 1)} disabled={busy} aria-label="Оновити графік" title="Оновити графік" className="refresh-button"><RefreshCw size={17} className={busy ? "spinning" : ""} /></Button>
          </div>
        </div>
        {mode !== "queue" && <AddressPicker refresh={refresh} onChange={setAddress} />}
        {mode !== "address" && <div className="address-bar">
          <div className="picker-heading">
            <div className="picker-heading-copy">
              <h2><ListOrdered size={17} />Черга ГПВ</h2>
              <p>Черга {queue}</p>
            </div>
            <Button variant="ghost" size="sm" aria-expanded={editingQueue} aria-controls="queue-inputs" onClick={() => setEditingQueue(value => !value)}>
              {editingQueue ? "Згорнути" : "Змінити"}<ChevronDown size={15} className={editingQueue ? "rotate-180" : undefined} />
            </Button>
          </div>
          <div id="queue-inputs" className="picker-inputs" hidden={!editingQueue}>
            <div className="queue-config">
              <div className="queue-picker">
                <NativeSelect aria-label="Черга ГПВ" value={queue} onChange={event => selectQueue(event.target.value)} className="queue-select">{QUEUES.map(value => <option key={value} value={value}>Черга {value}</option>)}</NativeSelect>
              </div>
              <span className="saved-hint"><Check size={12} /> Запам’ятаємо вибір</span>
            </div>
          </div>
          {address.details && !queueMatches && <div className="queue-config-note"><Info size={15} /><span>Черга не збігається з адресою.</span>{houseQueues.filter(isQueue).map(value => <Button key={value} variant="ghost" size="sm" onClick={() => selectQueue(value)}>ГПВ {value}</Button>)}</div>}
        </div>}
        {error && mode !== "address" && <div className="error-banner" role="alert"><Info size={19} /><span>{error}{data ? " Показано попередню відповідь; вона може бути застарілою." : ""}</span><Button variant="ghost" onClick={() => setRefresh(value => value + 1)}>Повторити <ArrowRight size={15} /></Button></div>}
        {mode === "address" ? <div className="day-content address-content">{addressPanel}</div> : queuePanel}
      </section>
      <footer className="site-footer"><p><span className="live-dot" />Автооновлення кожні 5 хвилин</p><a href="https://sm.e-svitlo.com.ua/" target="_blank" rel="noopener noreferrer">Джерело: E-Svitlo <ArrowUpRight size={14} /></a><p>Графік може змінюватись протягом дня</p></footer>
    </main>
  </div>;
}
