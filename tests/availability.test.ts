import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  createFirstAdmin,
  createUser,
  getBookingByReference,
  getDb,
  getPractitioners,
  getSlots,
  getTreatments,
  reserveBooking,
  type User,
} from "../src/lib/db";
import {
  archivePractitioner,
  savePractitioner,
  saveSlot,
  saveTreatment,
  updateBooking,
} from "../src/lib/admin";
import {
  deleteAvailabilityBlock,
  deleteAvailabilitySchedule,
  getAvailabilityBlocks,
  getAvailabilitySchedules,
  saveAvailabilityBlock,
  saveAvailabilitySchedule,
} from "../src/lib/availability";
import { hashPassword } from "../src/lib/security";
import { localDateTime, stockholmToIso } from "../src/lib/time";

// Every database operation in this file uses a newly created local fixture.
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
const temp = mkdtempSync(join(tmpdir(), "tibb-availability-tests-"));
process.env.TIBB_DATABASE_PATH = join(temp, "tibb.sqlite");
let admin: User;
let student: User;
let treatmentNumber = 0;
let practitionerNumber = 0;

before(async () => {
  admin = await createFirstAdmin({
    name: "Availability Admin",
    email: "availability-admin@example.test",
    passwordHash: hashPassword("availability admin test password"),
  });
  student = await createUser({
    name: "Availability Student",
    email: "availability-student@example.test",
    passwordHash: hashPassword("availability student test password"),
    role: "student",
  });
  // This legacy helper suite supplies its own booking fixtures because the
  // public Slowlax installation has no active booking setup.
  await getDb().prepare("UPDATE practitioners SET name='Isolated fixture practitioner',active=1 WHERE id=1").run();
  await getDb().prepare("UPDATE settings SET pay_on_site=1 WHERE id=1").run();
});

beforeEach(async () => {
  await getDb().prepare("DELETE FROM bookings").run();
  await getDb().prepare("DELETE FROM slots").run();
  for (const schedule of await getAvailabilitySchedules())
    await deleteAvailabilitySchedule(admin.id, schedule.id);
  for (const block of await getAvailabilityBlocks())
    await deleteAvailabilityBlock(admin.id, block.id);
});

after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
  assert.ok(basename(temp).startsWith("tibb-availability-tests-"));
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 15,
    retryDelay: 300,
  });
});

function dateAfter(days: number) {
  return localDateTime(
    new Date(Date.now() + days * 86_400_000).toISOString(),
  ).slice(0, 10);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}

function nextDstSunday(month: 2 | 9) {
  const today = dateAfter(0);
  for (let year = new Date().getUTCFullYear(); ; year++) {
    const last = new Date(Date.UTC(year, month + 1, 0, 12));
    last.setUTCDate(last.getUTCDate() - last.getUTCDay());
    const date = last.toISOString().slice(0, 10);
    if (date > today) return date;
  }
}

async function treatment(durationMinutes = 60) {
  const name = `Availability treatment ${++treatmentNumber}`;
  await saveTreatment(admin.id, {
    name,
    description: "Isolated availability test",
    durationMinutes,
    price: "700",
    active: true,
  });
  return (await getTreatments()).find((value) => value.name === name)!;
}

async function practitioner(active = true) {
  const name = `Availability practitioner ${++practitionerNumber}`;
  const id = await savePractitioner(admin.id, {
    name,
    description: "Isolated practitioner test",
    active,
  });
  return (await getPractitioners()).find((value) => value.id === id)!;
}

function scheduleInput(treatmentId: number, date = dateAfter(20)) {
  return {
    treatmentId,
    startDate: date,
    endDate: date,
    weekdays: [weekday(date)],
    startTime: "09:00",
    endTime: "12:00",
    breaks: [] as { startTime: string; endTime: string }[],
  };
}

function bookingInput(slotId: number) {
  return {
    slotId,
    name: "Availability Booking",
    email: "availability-booking@example.test",
    phone: "",
    paymentMethod: "onsite" as const,
  };
}

test("selected weekdays and treatment durations generate only complete appointments inside opening hours", async () => {
  const value = await treatment(45);
  const startDate = dateAfter(20);
  const endDate = addDays(startDate, 6);
  const selected = [weekday(startDate), weekday(addDays(startDate, 2))];
  const result = await saveAvailabilitySchedule(admin.id, {
    ...scheduleInput(value.id, startDate),
    endDate,
    weekdays: selected,
    endTime: "11:00",
  });
  assert.equal(result.created, 4);
  assert.equal(result.skipped, 0);
  const slots = await getSlots({ treatmentId: value.id });
  assert.equal(slots.length, 4);
  for (const slot of slots) {
    const start = localDateTime(slot.start);
    const end = localDateTime(slot.end);
    assert.ok(selected.includes(weekday(start.slice(0, 10))));
    assert.ok(start.slice(0, 10) >= startDate && end.slice(0, 10) <= endDate);
    assert.ok(start.slice(11) >= "09:00" && end.slice(11) <= "11:00");
    assert.equal((Date.parse(slot.end) - Date.parse(slot.start)) / 60_000, 45);
    assert.equal(slot.scheduleId, result.id);
  }
  assert.deepEqual(
    slots.map((slot) => localDateTime(slot.start).slice(11)),
    ["09:00", "09:45", "09:00", "09:45"],
  );
  const saved = (await getAvailabilitySchedules()).find(
    (item) => item.id === result.id,
  )!;
  assert.equal(saved.treatmentId, value.id);
  assert.deepEqual(saved.weekdays.toSorted(), selected.toSorted());
});

test("lunch and multiple breaks split the day without appointments crossing a break", async () => {
  const value = await treatment(45);
  const result = await saveAvailabilitySchedule(admin.id, {
    ...scheduleInput(value.id),
    endTime: "16:00",
    breaks: [
      { startTime: "11:00", endTime: "12:00" },
      { startTime: "14:00", endTime: "14:30" },
    ],
  });
  assert.equal(result.created, 6);
  const slots = await getSlots({ treatmentId: value.id });
  assert.deepEqual(
    slots.map((slot) => localDateTime(slot.start).slice(11)),
    ["09:00", "09:45", "12:00", "12:45", "14:30", "15:15"],
  );
  for (const slot of slots) {
    const start = localDateTime(slot.start).slice(11);
    const end = localDateTime(slot.end).slice(11);
    assert.ok(!(start < "12:00" && end > "11:00"));
    assert.ok(!(start < "14:30" && end > "14:00"));
  }
});

test("repeating a schedule is idempotent and another treatment cannot create overlapping availability", async () => {
  const first = await treatment();
  const second = await treatment(30);
  const input = scheduleInput(first.id);
  const original = await saveAvailabilitySchedule(admin.id, input);
  const ids = (await getSlots()).map((slot) => slot.id);
  const repeated = await saveAvailabilitySchedule(admin.id, input);
  assert.equal(original.created, 3);
  assert.equal(repeated.created, 0);
  assert.equal(repeated.skipped, 3);
  assert.equal(repeated.id, original.id);
  assert.equal((await getAvailabilitySchedules()).length, 1);
  assert.deepEqual(
    (await getSlots()).map((slot) => slot.id),
    ids,
  );
  await assert.rejects(
    saveAvailabilitySchedule(admin.id, {
      ...input,
      treatmentId: second.id,
    }),
    /överlappar/,
  );
  assert.equal((await getSlots({ treatmentId: second.id })).length, 0);
});

test("schedule dates, weekdays, times and breaks validate atomically", async () => {
  const value = await treatment();
  const input = scheduleInput(value.id);
  const invalid: Parameters<typeof saveAvailabilitySchedule>[1][] = [
    { ...input, startDate: dateAfter(-10), endDate: dateAfter(-10) },
    { ...input, startDate: dateAfter(740), endDate: dateAfter(740) },
    { ...input, endDate: addDays(input.startDate, -1) },
    { ...input, endDate: addDays(input.startDate, 90) },
    { ...input, startDate: "2027-02-30", endDate: "2027-02-30" },
    { ...input, weekdays: [] },
    { ...input, weekdays: [0] },
    { ...input, weekdays: [8] },
    { ...input, weekdays: [1.5] },
    { ...input, weekdays: [1, 1] },
    { ...input, startTime: "25:00" },
    { ...input, endTime: "08:00" },
    { ...input, endTime: input.startTime },
    { ...input, breaks: [{ startTime: "08:30", endTime: "09:30" }] },
    { ...input, breaks: [{ startTime: "11:30", endTime: "12:30" }] },
    { ...input, breaks: [{ startTime: "11:00", endTime: "10:00" }] },
    { ...input, breaks: [{ startTime: "10:00", endTime: "10:00" }] },
    {
      ...input,
      breaks: [
        { startTime: "09:30", endTime: "10:30" },
        { startTime: "10:00", endTime: "11:00" },
      ],
    },
  ];
  for (const invalidInput of invalid) {
    await assert.rejects(saveAvailabilitySchedule(admin.id, invalidInput));
    assert.equal((await getAvailabilitySchedules()).length, 0);
    assert.equal((await getSlots()).length, 0);
  }
  await assert.rejects(
    saveAvailabilitySchedule(admin.id, { ...input, treatmentId: 999_999 }),
  );
  const accepted = await saveAvailabilitySchedule(admin.id, {
    ...input,
    endDate: addDays(input.startDate, 89),
  });
  assert.ok(accepted.created > 0);
  assert.ok(
    (await getSlots()).every((slot) => Date.parse(slot.start) > Date.now()),
  );
});

test("Stockholm DST changes produce appointments with actual treatment durations", async () => {
  const value = await treatment(120);
  for (const [month, expected, expectedStarts] of [
    [2, 2, ["00:00", "03:00"]],
    [9, 3, ["00:00", "02:00", "03:00"]],
  ] as const) {
    const date = nextDstSunday(month);
    const result = await saveAvailabilitySchedule(admin.id, {
      ...scheduleInput(value.id, date),
      startTime: "00:00",
      endTime: "05:00",
    });
    assert.equal(result.created, expected);
    const slots = (await getSlots({ treatmentId: value.id })).filter(
      (slot) => slot.scheduleId === result.id,
    );
    assert.deepEqual(
      slots.map((slot) => localDateTime(slot.start).slice(11)),
      [...expectedStarts],
    );
    for (const slot of slots)
      assert.equal(
        (Date.parse(slot.end) - Date.parse(slot.start)) / 60_000,
        120,
      );
    assert.ok(
      slots.every((slot) => slot.end <= stockholmToIso(`${date}T05:00`)),
    );
  }
});

test("nonexistent spring times and ambiguous autumn boundaries reject without partial schedule writes", async () => {
  const value = await treatment();
  for (const month of [2, 9] as const) {
    const date = nextDstSunday(month);
    const input = {
      ...scheduleInput(value.id, date),
      startTime: "01:00",
      endTime: "05:00",
    };
    for (const invalid of [
      { ...input, startTime: "02:30" },
      { ...input, endTime: "02:30" },
      { ...input, breaks: [{ startTime: "02:30", endTime: "03:30" }] },
    ]) {
      await assert.rejects(saveAvailabilitySchedule(admin.id, invalid));
      assert.equal((await getAvailabilitySchedules()).length, 0);
      assert.equal((await getSlots()).length, 0);
    }
  }
});

test("full-day blocks use local midnight boundaries on 23-hour and 25-hour Swedish days", async () => {
  for (const [month, hours] of [
    [2, 23],
    [9, 25],
  ] as const) {
    const date = nextDstSunday(month);
    const id = await saveAvailabilityBlock(admin.id, {
      startDate: date,
      endDate: date,
      allDay: true,
      reason: "DST test day off",
    });
    const block = (await getAvailabilityBlocks()).find(
      (item) => item.id === id,
    )!;
    assert.equal(block.start, stockholmToIso(`${date}T00:00`));
    assert.equal(block.end, stockholmToIso(`${addDays(date, 1)}T00:00`));
    assert.equal(
      (Date.parse(block.end) - Date.parse(block.start)) / 3_600_000,
      hours,
    );
    assert.equal(block.allDay, true);
    await deleteAvailabilityBlock(admin.id, id);
  }
});

test("timed exceptions hide existing overlapping slots, reject stale booking links and restore the same slots when removed", async () => {
  const value = await treatment();
  const date = dateAfter(20);
  const before = await saveSlot(admin.id, value.id, `${date}T09:00`);
  const affected = await saveSlot(admin.id, value.id, `${date}T10:00`);
  const after = await saveSlot(admin.id, value.id, `${date}T11:00`);
  const id = await saveAvailabilityBlock(admin.id, {
    startDate: date,
    endDate: date,
    allDay: false,
    startTime: "10:00",
    endTime: "11:00",
    reason: "Lunch",
  });
  assert.deepEqual(
    (await getSlots()).map((slot) => slot.id),
    [before, after],
  );
  const adminSlots = await getSlots({ includeBlocked: true });
  assert.equal(adminSlots.find((slot) => slot.id === affected)?.blocked, true);
  assert.equal(adminSlots.find((slot) => slot.id === before)?.blocked, false);
  await assert.rejects(reserveBooking(bookingInput(affected)));
  await assert.rejects(saveSlot(admin.id, value.id, `${date}T10:15`));
  await deleteAvailabilityBlock(admin.id, id);
  assert.deepEqual(
    (await getSlots()).map((slot) => slot.id),
    [before, affected, after],
  );
  assert.equal(
    (await getSlots()).find((slot) => slot.id === affected)?.blocked,
    false,
  );
  assert.equal((await reserveBooking(bookingInput(affected))).slotId, affected);
});

test("schedule generation retains blocked candidates for later reopening while manual slots reject blocks", async () => {
  const value = await treatment();
  const date = dateAfter(20);
  const blockId = await saveAvailabilityBlock(admin.id, {
    startDate: date,
    endDate: date,
    allDay: false,
    startTime: "10:00",
    endTime: "11:00",
    reason: "Unavailable",
  });
  await assert.rejects(saveSlot(admin.id, value.id, `${date}T10:00`));
  const result = await saveAvailabilitySchedule(admin.id, {
    ...scheduleInput(value.id, date),
    endTime: "13:00",
  });
  assert.equal(result.created, 4);
  assert.equal(result.skipped, 0);
  assert.equal(result.blocked, 1);
  assert.deepEqual(
    (await getSlots()).map((slot) => localDateTime(slot.start).slice(11)),
    ["09:00", "11:00", "12:00"],
  );
  const hidden = (await getSlots({ includeBlocked: true })).find(
    (slot) => slot.blocked,
  )!;
  assert.equal(localDateTime(hidden.start).slice(11), "10:00");
  await deleteAvailabilityBlock(admin.id, blockId);
  assert.equal((await getSlots()).length, 4);
  assert.equal(
    (await getSlots()).some((slot) => slot.id === hidden.id),
    true,
  );
});

test("a continuous multiday timed exception uses explicit first and last times", async () => {
  const value = await treatment();
  const date = dateAfter(20);
  const firstOutside = await saveSlot(admin.id, value.id, `${date}T09:00`);
  const firstInside = await saveSlot(admin.id, value.id, `${date}T15:00`);
  const middle = await saveSlot(
    admin.id,
    value.id,
    `${addDays(date, 1)}T09:00`,
  );
  const lastOutside = await saveSlot(
    admin.id,
    value.id,
    `${addDays(date, 2)}T12:00`,
  );
  const id = await saveAvailabilityBlock(admin.id, {
    startDate: date,
    endDate: addDays(date, 2),
    allDay: false,
    startTime: "12:00",
    endTime: "12:00",
    reason: "Travel",
  });
  const block = (await getAvailabilityBlocks()).find((item) => item.id === id)!;
  assert.equal(block.start, stockholmToIso(`${date}T12:00`));
  assert.equal(block.end, stockholmToIso(`${addDays(date, 2)}T12:00`));
  assert.deepEqual(
    (await getSlots()).map((slot) => slot.id),
    [firstOutside, lastOutside],
  );
  assert.ok(
    (await getSlots({ includeBlocked: true }))
      .filter((slot) => slot.blocked)
      .every((slot) => [firstInside, middle].includes(slot.id)),
  );
});

test("block validation rejects malformed dates, reversed ranges and invalid or ambiguous local times atomically", async () => {
  const date = dateAfter(20);
  const input = {
    startDate: date,
    endDate: date,
    allDay: true,
    reason: "Validation",
  };
  for (const invalid of [
    { ...input, startDate: dateAfter(-5), endDate: dateAfter(-5) },
    { ...input, startDate: dateAfter(740), endDate: dateAfter(740) },
    { ...input, startDate: "2027-02-30", endDate: "2027-02-30" },
    { ...input, endDate: addDays(date, -1) },
    { ...input, allDay: false },
    { ...input, allDay: false, startTime: "25:00", endTime: "26:00" },
    { ...input, allDay: false, startTime: "11:00", endTime: "10:00" },
    { ...input, allDay: false, startTime: "10:00", endTime: "10:00" },
    ...([2, 9] as const).map((month) => ({
      ...input,
      startDate: nextDstSunday(month),
      endDate: nextDstSunday(month),
      allDay: false,
      startTime: "02:30",
      endTime: "04:00",
    })),
  ]) {
    await assert.rejects(saveAvailabilityBlock(admin.id, invalid));
    assert.equal((await getAvailabilityBlocks()).length, 0);
  }
  const longAbsence = await saveAvailabilityBlock(admin.id, {
    ...input,
    endDate: addDays(date, 90),
  });
  assert.equal(
    (await getAvailabilityBlocks()).find((block) => block.id === longAbsence)
      ?.end,
    stockholmToIso(`${addDays(date, 91)}T00:00`),
  );
});

test("a block overlapping an active booking rejects atomically while cancelled history can be blocked", async () => {
  const value = await treatment();
  const date = dateAfter(20);
  const id = await saveSlot(admin.id, value.id, `${date}T10:00`);
  const booking = await reserveBooking(bookingInput(id));
  const block = {
    startDate: addDays(date, -1),
    endDate: addDays(date, 1),
    allDay: true,
    reason: "Leave",
  };
  await assert.rejects(saveAvailabilityBlock(admin.id, block));
  assert.equal((await getAvailabilityBlocks()).length, 0);
  assert.equal(
    (await getBookingByReference(booking.reference))?.status,
    "confirmed",
  );
  assert.equal(
    (await getSlots()).find((slot) => slot.id === id)?.blocked,
    false,
  );
  await updateBooking(admin.id, booking.id, "cancelled", "pending");
  const blockId = await saveAvailabilityBlock(admin.id, block);
  assert.equal((await getSlots()).length, 0);
  assert.equal(
    (await getBookingByReference(booking.reference))?.status,
    "cancelled",
  );
  await deleteAvailabilityBlock(admin.id, blockId);
  assert.equal((await getSlots())[0].id, id);
});

test("booking and overlapping block creation cannot both win a concurrent race", async () => {
  const value = await treatment();
  const date = dateAfter(20);
  for (const reverse of [false, true]) {
    const day = reverse ? addDays(date, 1) : date;
    const slotId = await saveSlot(admin.id, value.id, `${day}T10:00`);
    const makeBooking = () => reserveBooking(bookingInput(slotId));
    const makeBlock = () =>
      saveAvailabilityBlock(admin.id, {
        startDate: day,
        endDate: day,
        allDay: true,
        reason: "Concurrent day off",
      });
    const results = await Promise.allSettled(
      reverse ? [makeBlock(), makeBooking()] : [makeBooking(), makeBlock()],
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected")!;
    assert.equal(rejected.status, "rejected");
    assert.match(String(rejected.reason), /spärr|bokning|tillgänglig/);
    const winner = results.find((result) => result.status === "fulfilled")!;
    assert.equal(winner.status, "fulfilled");
    const bookingWon = typeof winner.value !== "number";
    const visible = (await getSlots()).find((slot) => slot.id === slotId);
    if (bookingWon) assert.equal(visible?.booked, true);
    else assert.equal(visible, undefined);
  }
});

test("deleting a generated schedule removes free availability and preserves active and cancelled booking history", async () => {
  const value = await treatment();
  const result = await saveAvailabilitySchedule(
    admin.id,
    scheduleInput(value.id),
  );
  const slots = await getSlots({ treatmentId: value.id });
  const active = await reserveBooking(bookingInput(slots[0].id));
  const cancelled = await reserveBooking(bookingInput(slots[1].id));
  await updateBooking(admin.id, cancelled.id, "cancelled", "pending");
  await deleteAvailabilitySchedule(admin.id, result.id);
  assert.equal(
    (await getAvailabilitySchedules()).some((item) => item.id === result.id),
    false,
  );
  assert.equal(
    (await getBookingByReference(active.reference))?.status,
    "confirmed",
  );
  assert.equal(
    (await getBookingByReference(cancelled.reference))?.status,
    "cancelled",
  );
  for (const booking of [active, cancelled]) {
    assert.ok(
      await getDb()
        .prepare("SELECT id FROM slots WHERE id=?")
        .get(booking.slotId),
    );
    const saved = (await getBookingByReference(booking.reference))!;
    assert.equal(saved.start, booking.start);
    assert.equal(saved.end, booking.end);
    assert.equal(saved.priceOre, booking.priceOre);
  }
  assert.equal(
    (await getSlots({ treatmentId: value.id })).filter((slot) => !slot.booked)
      .length,
    0,
  );
  await assert.rejects(reserveBooking(bookingInput(slots[2].id)));
});

test("student accounts cannot create or delete schedules or availability blocks", async () => {
  const value = await treatment();
  const input = scheduleInput(value.id);
  await assert.rejects(
    saveAvailabilitySchedule(student.id, input),
    /behörighet/,
  );
  await assert.rejects(
    saveAvailabilityBlock(student.id, {
      startDate: input.startDate,
      endDate: input.endDate,
      allDay: true,
      reason: "Forbidden",
    }),
    /behörighet/,
  );
  const schedule = await saveAvailabilitySchedule(admin.id, input);
  const date = addDays(input.startDate, 1);
  const block = await saveAvailabilityBlock(admin.id, {
    startDate: date,
    endDate: date,
    allDay: true,
    reason: "Admin day off",
  });
  await assert.rejects(
    deleteAvailabilitySchedule(student.id, schedule.id),
    /behörighet/,
  );
  await assert.rejects(
    deleteAvailabilityBlock(student.id, block),
    /behörighet/,
  );
  assert.equal((await getAvailabilitySchedules()).length, 1);
  assert.equal((await getAvailabilityBlocks()).length, 1);
  assert.equal((await getSlots({ treatmentId: value.id })).length, 3);
});

test("different practitioners can offer and book the same time independently while one practitioner cannot double-book", async () => {
  const value = await treatment();
  const first = await practitioner();
  const second = await practitioner();
  const date = dateAfter(20);
  const firstSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T10:00`,
    first.id,
  );
  const secondSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T10:00`,
    second.id,
  );
  await assert.rejects(
    saveSlot(admin.id, value.id, `${date}T10:15`, first.id),
    /överlappar/,
  );
  const firstBooking = await reserveBooking(bookingInput(firstSlot));
  assert.equal(firstBooking.practitionerId, first.id);
  assert.equal(firstBooking.practitionerName, first.name);
  assert.equal(
    (await getSlots()).find((slot) => slot.id === firstSlot)?.booked,
    true,
  );
  assert.equal(
    (await getSlots()).find((slot) => slot.id === secondSlot)?.booked,
    false,
  );
  const secondBooking = await reserveBooking(bookingInput(secondSlot));
  assert.equal(secondBooking.practitionerId, second.id);
  assert.equal(secondBooking.start, firstBooking.start);
  assert.equal(secondBooking.end, firstBooking.end);
  await assert.rejects(
    reserveBooking(bookingInput(firstSlot)),
    /bokas|tillgänglig/,
  );
  await assert.rejects(
    reserveBooking(bookingInput(secondSlot)),
    /bokas|tillgänglig/,
  );
});

test("recurring schedules belong to their chosen practitioner and only conflict within that practitioner", async () => {
  const value = await treatment();
  const alternative = await treatment(30);
  const first = await practitioner();
  const second = await practitioner();
  const input = scheduleInput(value.id);
  const firstSchedule = await saveAvailabilitySchedule(admin.id, {
    ...input,
    practitionerId: first.id,
  });
  const secondSchedule = await saveAvailabilitySchedule(admin.id, {
    ...input,
    practitionerId: second.id,
  });
  assert.equal(firstSchedule.created, 3);
  assert.equal(secondSchedule.created, 3);
  const schedules = await getAvailabilitySchedules();
  assert.equal(
    schedules.find((item) => item.id === firstSchedule.id)?.practitionerId,
    first.id,
  );
  assert.equal(
    schedules.find((item) => item.id === secondSchedule.id)?.practitionerName,
    second.name,
  );
  const slots = await getSlots();
  assert.equal(
    slots.filter((slot) => slot.practitionerId === first.id).length,
    3,
  );
  assert.equal(
    slots.filter((slot) => slot.practitionerId === second.id).length,
    3,
  );
  await assert.rejects(
    saveAvailabilitySchedule(admin.id, {
      ...input,
      treatmentId: alternative.id,
      practitionerId: first.id,
    }),
    /överlappar/,
  );
  assert.equal((await getSlots()).length, 6);
  const repeated = await saveAvailabilitySchedule(admin.id, {
    ...input,
    practitionerId: second.id,
  });
  assert.equal(repeated.id, secondSchedule.id);
  assert.equal((await getAvailabilitySchedules()).length, 2);
});

test("a practitioner-specific exception blocks stale links only for that practitioner even when another practitioner is already booked", async () => {
  const value = await treatment();
  const first = await practitioner();
  const second = await practitioner();
  const date = dateAfter(20);
  const firstSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T10:00`,
    first.id,
  );
  const secondSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T10:00`,
    second.id,
  );
  const otherBooking = await reserveBooking(bookingInput(secondSlot));
  const blockId = await saveAvailabilityBlock(admin.id, {
    startDate: date,
    endDate: date,
    allDay: true,
    reason: "First practitioner unavailable",
    practitionerId: first.id,
  });
  const block = (await getAvailabilityBlocks()).find(
    (item) => item.id === blockId,
  )!;
  assert.equal(block.practitionerId, first.id);
  assert.equal(block.practitionerName, first.name);
  assert.deepEqual(
    (await getSlots()).map((slot) => slot.id),
    [secondSlot],
  );
  const allSlots = await getSlots({ includeBlocked: true });
  assert.equal(allSlots.find((slot) => slot.id === firstSlot)?.blocked, true);
  assert.equal(allSlots.find((slot) => slot.id === secondSlot)?.blocked, false);
  assert.equal(
    (await getBookingByReference(otherBooking.reference))?.status,
    "confirmed",
  );
  await assert.rejects(
    reserveBooking(bookingInput(firstSlot)),
    /spärr|tillgänglig/,
  );
  await assert.rejects(
    saveSlot(admin.id, value.id, `${date}T12:00`, first.id),
    /spärr/,
  );
  const otherFreeSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T12:00`,
    second.id,
  );
  assert.equal(
    (await reserveBooking(bookingInput(otherFreeSlot))).practitionerId,
    second.id,
  );
  await deleteAvailabilityBlock(admin.id, blockId);
  assert.equal(
    (await reserveBooking(bookingInput(firstSlot))).practitionerId,
    first.id,
  );
});

test("global exceptions affect every practitioner and cannot overlap a booking for any practitioner", async () => {
  const value = await treatment();
  const first = await practitioner();
  const second = await practitioner();
  const date = dateAfter(20);
  const firstSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T10:00`,
    first.id,
  );
  const secondSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T10:00`,
    second.id,
  );
  const input = {
    startDate: date,
    endDate: date,
    allDay: true,
    reason: "Reception closed",
  };
  const blockId = await saveAvailabilityBlock(admin.id, input);
  assert.equal(
    (await getAvailabilityBlocks()).find((item) => item.id === blockId)
      ?.practitionerId,
    null,
  );
  assert.equal((await getSlots()).length, 0);
  assert.ok(
    (await getSlots({ includeBlocked: true })).every((slot) => slot.blocked),
  );
  for (const slotId of [firstSlot, secondSlot])
    await assert.rejects(
      reserveBooking(bookingInput(slotId)),
      /spärr|tillgänglig/,
    );
  await deleteAvailabilityBlock(admin.id, blockId);
  assert.equal((await getSlots()).length, 2);
  const booking = await reserveBooking(bookingInput(secondSlot));
  await assert.rejects(
    saveAvailabilityBlock(admin.id, { ...input, practitionerId: null }),
    /bokning/,
  );
  assert.equal((await getAvailabilityBlocks()).length, 0);
  assert.equal(
    (await getBookingByReference(booking.reference))?.status,
    "confirmed",
  );
  assert.equal(
    (await getSlots()).find((slot) => slot.id === firstSlot)?.booked,
    false,
  );
});

test("generated availability respects practitioner-specific exceptions without hiding other practitioners", async () => {
  const value = await treatment();
  const first = await practitioner();
  const second = await practitioner();
  const input = scheduleInput(value.id);
  const blockId = await saveAvailabilityBlock(admin.id, {
    startDate: input.startDate,
    endDate: input.endDate,
    allDay: true,
    reason: "Only first practitioner unavailable",
    practitionerId: first.id,
  });
  const blockedSchedule = await saveAvailabilitySchedule(admin.id, {
    ...input,
    practitionerId: first.id,
  });
  const openSchedule = await saveAvailabilitySchedule(admin.id, {
    ...input,
    practitionerId: second.id,
  });
  assert.equal(blockedSchedule.created, 3);
  assert.equal(blockedSchedule.blocked, 3);
  assert.equal(openSchedule.created, 3);
  assert.equal(openSchedule.blocked, 0);
  assert.equal((await getSlots()).length, 3);
  assert.ok(
    (await getSlots()).every((slot) => slot.practitionerId === second.id),
  );
  await deleteAvailabilityBlock(admin.id, blockId);
  assert.equal((await getSlots()).length, 6);
});

test("archiving a practitioner removes public selection and refuses new bookings while preserving existing slots and booking history", async () => {
  const value = await treatment();
  const provider = await practitioner();
  const date = dateAfter(20);
  const bookedSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T09:00`,
    provider.id,
  );
  const freeSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T10:00`,
    provider.id,
  );
  const booking = await reserveBooking(bookingInput(bookedSlot));
  await archivePractitioner(admin.id, provider.id);
  assert.equal(
    (await getPractitioners({ activeOnly: true })).some(
      (item) => item.id === provider.id,
    ),
    false,
  );
  assert.equal(
    (await getPractitioners()).find((item) => item.id === provider.id)?.active,
    false,
  );
  await assert.rejects(reserveBooking(bookingInput(freeSlot)), /tillgänglig/);
  await assert.rejects(
    saveSlot(admin.id, value.id, `${date}T12:00`, provider.id),
  );
  await assert.rejects(
    saveAvailabilitySchedule(admin.id, {
      ...scheduleInput(value.id, addDays(date, 1)),
      practitionerId: provider.id,
    }),
  );
  const history = (await getBookingByReference(booking.reference))!;
  assert.equal(history.status, "confirmed");
  assert.equal(history.practitionerId, provider.id);
  assert.equal(history.practitionerName, provider.name);
  assert.equal(history.start, booking.start);
  for (const id of [bookedSlot, freeSlot])
    assert.ok(await getDb().prepare("SELECT id FROM slots WHERE id=?").get(id));
  await assert.rejects(
    getDb().prepare("DELETE FROM practitioners WHERE id=?").run(provider.id),
  );
  assert.ok(await getBookingByReference(booking.reference));
});

test("practitioner names are snapshotted on bookings while renamed profiles are used for subsequent bookings", async () => {
  const value = await treatment();
  const provider = await practitioner();
  const date = dateAfter(20);
  const firstSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T09:00`,
    provider.id,
  );
  const secondSlot = await saveSlot(
    admin.id,
    value.id,
    `${date}T10:00`,
    provider.id,
  );
  const firstBooking = await reserveBooking(bookingInput(firstSlot));
  const renamed = `${provider.name} renamed`;
  await savePractitioner(admin.id, {
    id: provider.id,
    name: renamed,
    description: "Updated profile",
    active: true,
  });
  assert.equal(
    (await getSlots()).find((slot) => slot.id === secondSlot)?.practitionerName,
    renamed,
  );
  assert.equal(
    (await getBookingByReference(firstBooking.reference))?.practitionerName,
    provider.name,
  );
  const secondBooking = await reserveBooking(bookingInput(secondSlot));
  assert.equal(secondBooking.practitionerId, provider.id);
  assert.equal(secondBooking.practitionerName, renamed);
  assert.equal(
    (await getBookingByReference(firstBooking.reference))?.practitionerName,
    provider.name,
  );
});

test("student accounts cannot create, edit or archive practitioners and inactive or unknown practitioner selections reject atomically", async () => {
  const provider = await practitioner();
  const inactive = await practitioner(false);
  const value = await treatment();
  const initialCount = (await getPractitioners()).length;
  await assert.rejects(
    savePractitioner(student.id, {
      name: "Forbidden practitioner",
      description: "",
      active: true,
    }),
    /behörighet/,
  );
  await assert.rejects(
    savePractitioner(student.id, {
      id: provider.id,
      name: "Forbidden edit",
      description: "",
      active: false,
    }),
    /behörighet/,
  );
  await assert.rejects(
    archivePractitioner(student.id, provider.id),
    /behörighet/,
  );
  assert.equal((await getPractitioners()).length, initialCount);
  assert.equal(
    (await getPractitioners()).find((item) => item.id === provider.id)?.name,
    provider.name,
  );
  assert.equal(
    (await getPractitioners()).find((item) => item.id === provider.id)?.active,
    true,
  );
  for (const practitionerId of [inactive.id, 999_999]) {
    await assert.rejects(
      saveAvailabilitySchedule(admin.id, {
        ...scheduleInput(value.id),
        practitionerId,
      }),
    );
    await assert.rejects(
      saveSlot(admin.id, value.id, `${dateAfter(20)}T10:00`, practitionerId),
    );
    assert.equal((await getAvailabilitySchedules()).length, 0);
    assert.equal((await getSlots()).length, 0);
  }
});
