import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mergeSlots, normalizeSlots, parseSchedule, stateFor, kyivClock, time, isQueue } from '../lib/schedule.ts';
const raw = (start_time, end_time, status = 1, cherga = '1.1') => ({ start_time, end_time, status, cherga });
const response = slots => ({ data: { no_data: true, date_today: '30.10.2026', cherga_n: '1.1', gpv_schedule: slots } });
test('no_data does not hide received intervals; midnight ends at 24:00', () => {
  const data = parseSchedule(response([raw('00:00', '23:30', 3), raw('23:30', '00:00', 1)]), '1.1');
  assert.equal(data.days[0].noData, true);
  assert.equal(data.days[0].slots.length, 2);
  assert.equal(data.days[0].slots[1].end, 1440);
  assert.equal(time(1440), '24:00');
  assert.equal(stateFor(1).kind, 'off');
  assert.equal(stateFor(3).kind, 'on');
  assert.equal(stateFor(2).kind, 'unknown');
  assert.equal(stateFor(99).kind, 'unknown');
});
test('adjacent outage slots merge without merging across a gap or another status', () => {
  const slots = normalizeSlots([raw('02:00', '02:30'), raw('02:30', '03:00'), raw('04:00', '04:30')], '1.1');
  assert.deepEqual(mergeSlots(slots).filter(s => s.status === 1), [{ start: 120, end: 180, status: 1 }, { start: 240, end: 270, status: 1 }]);
  assert.equal(slots.reduce((n, s) => n + s.end - s.start, 0), 1440);
  assert.equal(slots.find(s => s.start === 180).status, -1);
  assert.equal(slots[0].end, 120);
});
test('live 3.2 response: numeric outages appear even when the entire grid says power is on', () => {
  const body = JSON.parse(readFileSync(new URL('./fixtures/queue-3.2-2026-11-02.json', import.meta.url), 'utf8'));
  assert.ok(body.data.gpv_schedule.every(slot => slot.status === 3));
  const { days } = parseSchedule(body, '3.2');
  assert.deepEqual(mergeSlots(days[0].slots).filter(slot => stateFor(slot.status).kind === 'off'), [
    { start: 600, end: 720, status: 1 },
  ]);
  assert.equal(days[0].slots.filter(slot => slot.status === 1).reduce((n, slot) => n + slot.end - slot.start, 0), 120);
  assert.equal(days[1].slots.filter(slot => slot.status === 1).length, 0);
});
test('numeric outages split slots at exact times and preserve grid outages, gaps and tomorrow', () => {
  const body = response([raw('00:00', '01:00', 1), raw('01:00', '23:30', 3)]);
  body.data.lst_time_disc = [{ start_time: '10:15', end_time: '12:10' }, { start_time: '23:45', end_time: '00:00' }];
  body.data.dict_tom = { ...response([raw('00:00', '24:00', 3)]).data, date_today: '31.10.2026', lst_time_disc: [{ start_time: '08:00', end_time: '09:00' }] };
  const { days } = parseSchedule(body, '1.1');
  assert.equal(days[0].noData, true);
  assert.deepEqual(mergeSlots(days[0].slots), [
    { start: 0, end: 60, status: 1 }, { start: 60, end: 615, status: 3 },
    { start: 615, end: 730, status: 1 }, { start: 730, end: 1410, status: 3 },
    { start: 1410, end: 1425, status: -1 }, { start: 1425, end: 1440, status: 1 },
  ]);
  assert.deepEqual(mergeSlots(days[1].slots).filter(slot => slot.status === 1), [{ start: 480, end: 540, status: 1 }]);
  assert.equal(days[0].slots.reduce((n, slot) => n + slot.end - slot.start, 0), 1440);
  body.data.lst_time_disc = [];
  assert.deepEqual(parseSchedule(body, '1.1').days[0].slots, normalizeSlots(body.data.gpv_schedule, '1.1'));
});
test('invalid numeric outage intervals fail validation', () => {
  for (const lst_time_disc of [
    [{ start_time: '25:00', end_time: '26:00' }],
    [{ start_time: '12:00', end_time: '10:00' }],
    [{ start_time: '10:00', end_time: '12:00' }, { start_time: '11:00', end_time: '13:00' }],
    [{ start_time: '10:00' }],
  ]) {
    const body = response([raw('00:00', '24:00', 3)]);
    body.data.lst_time_disc = lst_time_disc;
    assert.throws(() => parseSchedule(body, '1.1'));
  }
});
test('overlaps, invalid times, queue mismatches and malformed server data fail closed', () => {
  assert.throws(() => normalizeSlots([raw('00:00', '01:00'), raw('00:30', '01:30')], '1.1'));
  assert.throws(() => normalizeSlots([raw('24:30', '00:00')], '1.1'));
  assert.throws(() => parseSchedule(response([raw('00:00', '01:00', 1, '3.2')]), '1.1'));
  assert.throws(() => parseSchedule({ data: {} }, '1.1'));
  assert.equal(isQueue('../secret'), false);
  assert.equal(isQueue('6.2'), true);
});
test('clock follows Kyiv summer/winter time rather than browser timezone', () => {
  assert.equal(kyivClock(Date.parse('2026-07-01T21:30:00Z')).date, '02.07.2026');
  assert.equal(kyivClock(Date.parse('2026-10-30T21:30:00Z')).time, '23:30');
});
