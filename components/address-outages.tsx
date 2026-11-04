"use client";
import { useEffect, useState } from "react";
import { Info, MapPin, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { isQueue, kyivClock, type Schedule } from "@/lib/schedule";
import type { AddressDetails, AddressOption } from "@/lib/shutdowns";

type Address = { city: AddressOption | null; street: AddressOption | null; house: AddressOption | null };
const EMPTY: Address = { city: null, street: null, house: null };
export type AddressStatus = { details: AddressDetails | null; selected: boolean; label: string; loading: boolean; error: string };
const validOption = (value: unknown): value is AddressOption => !!value && typeof value === "object" && "id" in value && typeof value.id === "string" && /^\d{1,15}$/.test(value.id) && "label" in value && typeof value.label === "string" && value.label.length <= 200;

function AddressField({ resource, parent, label, selected, onSelect }: { resource: "cities" | "streets" | "houses"; parent?: string; label: string; selected: AddressOption | null; onSelect: (value: AddressOption | null) => void }) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<AddressOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const enabled = resource === "cities" || !!parent;
  useEffect(() => {
    setOptions([]); setError("");
    if (!enabled || search.trim().length < (resource === "houses" ? 1 : 2)) { setLoading(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ resource, search: search.trim() });
      if (parent) params.set(resource === "streets" ? "cityId" : "streetId", parent);
      fetch(`/api/shutdowns?${params}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
        const body = await response.json() as { options: AddressOption[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Не вдалося знайти адресу");
        if (!controller.signal.aborted) setOptions(body.options);
      }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [resource, parent, enabled, search]);
  const choices = selected && !options.some(option => option.id === selected.id) ? [selected, ...options] : options;
  return <div className="address-field"><label htmlFor={`address-${resource}`}>{label}</label><Input aria-label={`Пошук: ${label}`} placeholder={resource === "houses" ? "Номер будинку" : "Введи щонайменше 2 літери"} value={search} onChange={event => setSearch(event.target.value)} disabled={!enabled} maxLength={100} /><NativeSelect id={`address-${resource}`} value={selected?.id ?? ""} disabled={!enabled} onChange={event => onSelect(choices.find(option => option.id === event.target.value) ?? null)}><option value="">{loading ? "Шукаємо…" : choices.length ? "Обери зі списку" : "Немає результатів"}</option>{choices.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</NativeSelect>{error && <p role="alert">{error}</p>}</div>;
}

export function AddressOutages({ schedule, refresh, onQueue, onChange }: { schedule: Schedule | null; refresh: number; onQueue: (queue: string) => void; onChange: (status: AddressStatus) => void }) {
  const [address, setAddress] = useState<Address>(EMPTY);
  const [ready, setReady] = useState(false);
  const [details, setDetails] = useState<AddressDetails | null>(null);
  const [detailsFor, setDetailsFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("svitlo.address") || "null");
      if (saved && validOption(saved.city) && validOption(saved.street) && validOption(saved.house)) setAddress(saved);
    } catch { /* Saving an address is optional. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { if (address.house) localStorage.setItem("svitlo.address", JSON.stringify(address)); else localStorage.removeItem("svitlo.address"); } catch { /* Saving an address is optional. */ }
  }, [address, ready]);
  const key = address.house && address.street ? `${address.street.id}:${address.house.id}` : "";
  useEffect(() => {
    setError("");
    if (!ready || !key) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ resource: "details", streetId: address.street!.id, houseId: address.house!.id });
    if (refresh || reload) params.set("fresh", "1");
    fetch(`/api/shutdowns?${params}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json() as AddressDetails & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не вдалося отримати відключення");
      if (!controller.signal.aborted) { setDetails(body); setDetailsFor(key); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, key, address.street, address.house, refresh, reload]);
  const data = key && key === detailsFor ? details : null;
  const label = [address.city?.label, address.street?.label, address.house?.label].filter(Boolean).join(", ");
  useEffect(() => onChange({ details: data, selected: !!key, label, loading, error }), [data, key, label, loading, error, onChange]);
  const matches = !!data && !!schedule && data.queues["ГПВ"].includes(schedule.queue);
  return <section className="dashboard address-dashboard" aria-label="Поточні та ремонтні відключення">
    <div className="address-heading"><div><h2><MapPin size={20} />Поточні та ремонтні відключення</h2><p>Обери будинок — адресні відключення додадуться до ГПВ на спільному графіку нижче.</p></div>{address.house && <Button variant="outline" size="icon" aria-label="Оновити відключення за адресою" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={17} className={loading ? "spinning" : ""} /></Button>}</div>
    <div className="address-fields"><AddressField resource="cities" label="Населений пункт" selected={address.city} onSelect={city => setAddress({ city, street: null, house: null })} /><AddressField key={address.city?.id ?? "city"} resource="streets" parent={address.city?.id} label="Вулиця" selected={address.street} onSelect={street => setAddress(value => ({ ...value, street, house: null }))} /><AddressField key={address.street?.id ?? "street"} resource="houses" parent={address.street?.id} label="Будинок" selected={address.house} onSelect={house => setAddress(value => ({ ...value, house }))} /></div>
    <div className="address-privacy"><span>Запам’ятовуємо вибір у цьому браузері.</span>{address.house && <Button variant="ghost" size="sm" onClick={() => { setAddress(EMPTY); setDetails(null); }}>Очистити адресу</Button>}</div>
    {error && <div className="error-banner" role="alert"><Info size={17} /><span>{error}{data ? " Показано попередню відповідь; вона може бути застарілою." : ""}</span><Button variant="ghost" onClick={() => setReload(value => value + 1)}>Повторити</Button></div>}
    {loading && !data && <p className="address-loading" role="status">Отримуємо відключення за адресою…</p>}
    {data && <div className="day-content" aria-busy={loading}>
      <div className="section-heading"><div><h2>{address.city?.label}, {address.street?.label}, {address.house?.label}</h2><p>Номери черг за адресою · перевірено о {kyivClock(Date.parse(data.fetchedAt)).time}</p></div></div>
      <div className="address-queues">{["ГПВ", "ГАВ", "СГАВ", "АЧР"].map(type => <div key={type}><span>{type}</span><strong>{data.queues[type as keyof typeof data.queues].join(", ") || "Не вказано"}</strong></div>)}</div>
      <p className="address-caption">Номер черги не означає, що відповідний графік зараз застосовано. Усі отримані відключення враховано на спільній шкалі нижче.</p>
      {!matches && <div className="source-notice"><Info size={17} /><div>ГПВ обраної черги не додано до цього будинку.{data.queues["ГПВ"].filter(isQueue).map(queue => <Button key={queue} variant="ghost" size="sm" onClick={() => onQueue(queue)}>Показати ГПВ {queue}</Button>)}</div></div>}
      <a className="address-source" href="https://www.soe.com.ua/consumers/shutdowns" target="_blank" rel="noopener noreferrer">Джерело: Сумиобленерго →</a>
    </div>}
  </section>;
}
