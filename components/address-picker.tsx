"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { kyivClock } from "@/lib/schedule";
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
  return <div className="address-field">
    <label htmlFor={`address-${resource}`}>{label}</label>
    <Input aria-label={`Пошук: ${label}`} placeholder={resource === "houses" ? "Номер будинку" : "Введи щонайменше 2 літери"} value={search} onChange={event => setSearch(event.target.value)} disabled={!enabled} maxLength={100} />
    <NativeSelect id={`address-${resource}`} value={selected?.id ?? ""} disabled={!enabled} onChange={event => onSelect(choices.find(option => option.id === event.target.value) ?? null)}>
      <option value="">{loading ? "Шукаємо…" : choices.length ? "Обери зі списку" : "Немає результатів"}</option>
      {choices.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </NativeSelect>
    {error && <p role="alert">{error}</p>}
  </div>;
}

/** Address selection plus the house's own shutdown details; reports both upwards. */
export function AddressPicker({ refresh, onChange }: { refresh: number; onChange: (status: AddressStatus) => void }) {
  const [address, setAddress] = useState<Address>(EMPTY);
  const [draft, setDraft] = useState<Address | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
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
  const expanded = !key || draft !== null;
  const fields = draft ?? address;
  useLayoutEffect(() => {
    if (!expanded && returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [expanded]);

  const confirmAddress = () => {
    if (!fields.house) return;
    returnFocus.current = true;
    setAddress(fields);
    setDraft(null);
  };
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
  const checked = data ? kyivClock(Date.parse(data.fetchedAt)).time : "";
  return <div className="address-bar">
    <div className="picker-heading">
      <div className="picker-heading-copy">
        <h2><MapPin size={17} />Моя адреса</h2>
        {key && <p>{label}</p>}
      </div>
      {key && <Button ref={editButton} variant="ghost" size="sm" aria-expanded={expanded} aria-controls="address-inputs" onClick={() => setDraft(expanded ? null : address)}>
        {expanded ? "Скасувати" : "Змінити"}<ChevronDown size={15} className={expanded ? "rotate-180" : undefined} />
      </Button>}
    </div>
    <div id="address-inputs" className="picker-inputs" hidden={!expanded}>
      {expanded && <>
        <div className="address-fields">
          <AddressField resource="cities" label="Населений пункт" selected={fields.city} onSelect={city => setDraft({ city, street: null, house: null })} />
          <AddressField key={fields.city?.id ?? "city"} resource="streets" parent={fields.city?.id} label="Вулиця" selected={fields.street} onSelect={street => setDraft({ ...fields, street, house: null })} />
          <AddressField key={fields.street?.id ?? "street"} resource="houses" parent={fields.street?.id} label="Будинок" selected={fields.house} onSelect={house => setDraft({ ...fields, house })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={!fields.house} onClick={confirmAddress}>Готово</Button>
          {key && <Button variant="ghost" size="sm" onClick={() => { setAddress(EMPTY); setDraft(null); setDetails(null); setDetailsFor(""); }}>Очистити</Button>}
        </div>
      </>}
    </div>
    {error && <div className="error-banner" role="alert"><span>{error}{data ? " Показано попередню відповідь; вона може бути застарілою." : ""}</span><Button variant="ghost" onClick={() => setReload(value => value + 1)}>Повторити</Button></div>}
    {data && <p className="address-bar-note">Відключення за адресою · перевірено о {checked}<span className="address-bar-dot" />ГПВ {data.queues["ГПВ"].join(", ") || "не вказано"}</p>}
    {!key && <p className="address-bar-note">Запам’ятовуємо вибір у цьому браузері. Це єдині дані, які стосуються саме твого будинку.</p>}
  </div>;
}
