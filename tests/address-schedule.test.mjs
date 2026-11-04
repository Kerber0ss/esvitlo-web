import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressDaySlots, addressDayTimeline, outageOnDate } from '../lib/address-schedule.ts';
import { mergeSlots, parseSchedule } from '../lib/schedule.ts';

const event = (start, end) => ({ city: 'Місто', street: 'Тестова', house: '12', start, end, typeCode: 7, label: 'Термінові планові роботи' });
const details = outages => ({ fetchedAt: '2026-11-02T10:00:00Z', outages, queues: { ГПВ: ['3.2'], ГАВ: [], СГАВ: ['2'], АЧР: ['3'], САВН: [], ГОП: [], ГОЕ: [] } });
const schedule = () => parseSchedule({ data: { date_today: '02.11.2026', no_data: false, cherga_n: '3.2', gpv_schedule: [{ start_time: '00:00', end_time: '24:00', status: 3 }], lst_time_disc: [{ start_time: '10:00', end_time: '12:00' }] } }, '3.2');

test('GPV 10–12 plus repair 10–18 is one 8-hour outage without double counting', () => {
  const data = details([event('2026-11-02T10:00:00', '2026-11-02T18:00:00'), event('2026-11-02T11:00:00', '2026-11-02T13:00:00')]);
  const slots = addressDaySlots(data, schedule(), '02.11.2026');
  assert.deepEqual(mergeSlots(slots), [{ start: 0, end: 600, status: 3 }, { start: 600, end: 1080, status: 1 }, { start: 1080, end: 1440, status: 3 }]);
  assert.equal(slots.filter(slot => slot.status === 1).reduce((sum, slot) => sum + slot.end - slot.start, 0), 480);
  assert.equal(slots.reduce((sum, slot) => sum + slot.end - slot.start, 0), 1440);
});
test('address outages cross midnight without moving Kyiv wall times or spilling into tomorrow', () => {
  const outage = event('2026-11-02T23:30:00', '2026-11-03T01:15:00');
  assert.deepEqual(outageOnDate(outage, '02.11.2026'), { start: 1410, end: 1440 });
  assert.deepEqual(outageOnDate(outage, '03.11.2026'), { start: 0, end: 75 });
  assert.equal(outageOnDate(outage, '04.11.2026'), null);
  assert.equal(outageOnDate(event('2026-11-02T22:00:00', '2026-11-03T00:00:00'), '03.11.2026'), null);
});
test('a different GPV queue or missing date never supplies power-on intervals for this house', () => {
  const data = details([event('2026-11-02T10:00:00', '2026-11-02T18:00:00')]);
  const wrongQueue = { ...schedule(), queue: '1.1' };
  const expected = [{ start: 0, end: 600, status: -1 }, { start: 600, end: 1080, status: 1 }, { start: 1080, end: 1440, status: -1 }];
  assert.deepEqual(mergeSlots(addressDaySlots(data, wrongQueue, '02.11.2026')), expected);
  assert.deepEqual(mergeSlots(addressDaySlots(data, null, '02.11.2026')), expected);
  assert.deepEqual(addressDaySlots(data, schedule(), '03.11.2026'), [{ start: 0, end: 1440, status: -1 }]);
});
test('one timeline marks the overlap and carries both causes without extending the outage', () => {
  const data = details([event('2026-11-02T11:00:00', '2026-11-02T18:00:00')]);
  const slots = addressDayTimeline(data, schedule(), '02.11.2026');
  assert.deepEqual(slots.filter(slot => slot.status === 1), [
    { start: 600, end: 660, status: 1, causes: ['ГПВ 3.2'], outageKind: 'gpv' },
    { start: 660, end: 720, status: 1, causes: ['ГПВ 3.2', 'Термінові планові роботи'], outageKind: 'overlap' },
    { start: 720, end: 1080, status: 1, causes: ['Термінові планові роботи'], outageKind: 'address' },
  ]);
  assert.equal(slots.filter(slot => slot.status === 1).reduce((sum, slot) => sum + slot.end - slot.start, 0), 480);
});
test('overlapping address causes are visible without importing a different queue or another date', () => {
  const repair = event('2026-11-02T10:00:00', '2026-11-02T18:00:00');
  const emergency = { ...event('2026-11-02T11:00:00', '2026-11-02T12:00:00'), label: 'Аварійне відключення' };
  const data = details([repair, emergency]);
  const slots = addressDayTimeline(data, { ...schedule(), queue: '1.1' }, '02.11.2026');
  const overlap = slots.find(slot => slot.start === 660);
  assert.equal(overlap.outageKind, 'overlap');
  assert.deepEqual(overlap.causes, ['Термінові планові роботи', 'Аварійне відключення']);
  assert.equal(slots[0].status, -1);
  assert.ok(slots.every(slot => !slot.causes.some(cause => cause.startsWith('ГПВ'))));
  assert.deepEqual(addressDayTimeline(data, schedule(), '03.11.2026'), [{ start: 0, end: 1440, status: -1, causes: [], outageKind: null }]);
});
