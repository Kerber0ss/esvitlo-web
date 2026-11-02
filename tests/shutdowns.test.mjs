import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeSoePayload, parseAddressDetails, parseAddressOptions, parseShutdownQuery } from '../lib/shutdowns.ts';

const response = list => ({ data: { result: 0, list } });
const outage = (start = '2026-11-02T10:00:00', end = '2026-11-02T18:00:00', type = 7) => ['Місто', 'Тестова', '12', start, end, type, '', ''];
const queues = () => response([['м.Місто', 'вулиця Тестова', '12', ['8', '3', '2', '3.2, 6.2,3.2', null, null, null]]]);

test('address options and fixed-resource requests validate the API boundary', () => {
  assert.deepEqual(parseAddressOptions(response([[123, 'м.Місто'], ['456', 'вулиця Тестова']])), [{ id: '123', label: 'м.Місто' }, { id: '456', label: 'вулиця Тестова' }]);
  assert.deepEqual(parseShutdownQuery(new URL('http://localhost/api/shutdowns?resource=details&houseId=123&streetId=456')), { resource: 'details', houseId: '123', streetId: '456' });
  assert.deepEqual(parseShutdownQuery(new URL('http://localhost/api/shutdowns?resource=cities&search=%20Місто%20')), { resource: 'cities', search: 'Місто' });
  for (const query of ['resource=https://other.test', 'resource=streets', 'resource=cities&search=', 'resource=houses&streetId=123&search=', 'resource=details&houseId=1', 'resource=houses&streetId=../../file', 'resource=details&houseId=-1&streetId=2', `resource=cities&search=${'x'.repeat(101)}`]) {
    assert.throws(() => parseShutdownQuery(new URL('http://localhost/api/shutdowns?' + query)));
  }
  assert.throws(() => parseAddressOptions({ data: { result: 1, list: [] } }));
  assert.throws(() => parseAddressOptions(response([['https://other.test', 'Wrong ID']])));
});

test('urgent planned works retain exact Kyiv wall times and address-specific queue numbers', () => {
  const details = parseAddressDetails(response([outage()]), queues(), '2026-11-02T10:15:00Z');
  assert.deepEqual(details.outages, [{ city: 'Місто', street: 'Тестова', house: '12', start: '2026-11-02T10:00:00', end: '2026-11-02T18:00:00', typeCode: 7, label: 'Термінові планові роботи' }]);
  assert.deepEqual(details.queues, { ГАВ: ['8'], АЧР: ['3'], СГАВ: ['2'], ГПВ: ['3.2', '6.2'], САВН: [], ГОП: [], ГОЕ: [] });
  assert.equal(details.fetchedAt, '2026-11-02T10:15:00Z');
  assert.equal(parseAddressDetails(response([outage(undefined, undefined, 99)]), queues()).outages[0].label, 'Тип відключення 99');
});

test('empty results remain distinct from malformed intervals or the wrong house', () => {
  assert.deepEqual(parseAddressDetails(response([]), response([])).outages, []);
  assert.deepEqual(parseAddressDetails(response([]), response([])).queues.ГПВ, []);
  for (const [start, end] of [
    ['2026-02-30T10:00:00', '2026-02-30T18:00:00'],
    ['2026-11-02T24:00:00', '2026-11-03T01:00:00'],
    ['2026-11-02T18:00:00', '2026-11-02T10:00:00'],
    ['2026-11-02T10:00:00Z', '2026-11-02T18:00:00Z'],
  ]) assert.throws(() => parseAddressDetails(response([outage(start, end)]), queues()));
  const wrong = queues(); wrong.data.list[0][2] = '99';
  assert.throws(() => parseAddressDetails(response([outage()]), wrong));
  const many = queues(); many.data.list.push(...queues().data.list);
  assert.throws(() => parseAddressDetails(response([]), many));
  assert.throws(() => parseAddressDetails(response([]), { data: { result: 1, list: [] } }));
});

test('the public website AES-GCM envelope decodes and tampering fails closed', async () => {
  const date = new Date('2026-11-02T10:00:00Z');
  const material = `qasdw-enjenf-twfeft!!d451qwqw!-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${Math.floor(date.getMinutes() / 5)}`.padEnd(32, 'x').slice(0, 32);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(material), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const source = response([[123, 'м.Місто']]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(source))));
  const bytes = new Uint8Array(iv.length + ciphertext.length); bytes.set(iv); bytes.set(ciphertext, iv.length);
  const body = { payload: Buffer.from(bytes).toString('base64') };
  assert.deepEqual(await decodeSoePayload(body, date), source);
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decodeSoePayload({ payload: Buffer.from(bytes).toString('base64') }, date));
  await assert.rejects(decodeSoePayload({ payload: 'AAAA' }, date));
  await assert.rejects(decodeSoePayload({ payload: 'not base64!' }, date));
});
