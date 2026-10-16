import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { DatabaseAdapter } from "../src/lib/database";
import { getDb, getSlots } from "../src/lib/db";
import { saveAvailabilitySchedule } from "../src/lib/availability";
import { hashPassword, verifyPassword } from "../src/lib/security";
import { localDateTime, stockholmToIso } from "../src/lib/time";

// This process never inherits a deployment database connection.
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;

// Deliberately independent of the new SCHEMA: this is the table shape and
// existing history trigger used before recurring availability was introduced.
const LEGACY_SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','student')), created_at TEXT NOT NULL);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), site_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, location TEXT NOT NULL, pay_on_site INTEGER NOT NULL, stripe_enabled INTEGER NOT NULL);
CREATE TABLE treatments (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, duration_minutes INTEGER NOT NULL, price_ore INTEGER NOT NULL, active INTEGER NOT NULL);
CREATE TABLE slots (id INTEGER PRIMARY KEY, treatment_id INTEGER NOT NULL REFERENCES treatments(id), start TEXT NOT NULL, end TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, CHECK(end>start));
CREATE TABLE bookings (id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, treatment_id INTEGER NOT NULL REFERENCES treatments(id), slot_id INTEGER NOT NULL REFERENCES slots(id), treatment_name TEXT NOT NULL, duration_minutes INTEGER NOT NULL, price_ore INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'pending', checkout_session_id TEXT UNIQUE, expires_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO app_meta(key,value) VALUES('seeded','1');
CREATE TRIGGER treatments_preserve_history BEFORE DELETE ON treatments
  WHEN EXISTS(SELECT 1 FROM slots WHERE treatment_id=OLD.id) OR EXISTS(SELECT 1 FROM bookings WHERE treatment_id=OLD.id)
  BEGIN SELECT RAISE(ABORT,'Treatment has booking history'); END;
`;

test("availability migration preserves legacy accounts, slots and bookings and adds history guards without replacing old triggers", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "tibb-availability-migration-"),
  );
  process.env.TIBB_DATABASE_PATH = join(directory, "legacy.sqlite");
  const raw = createClient({
    url: pathToFileURL(process.env.TIBB_DATABASE_PATH).href,
    intMode: "number",
  });
  const migrated = new DatabaseAdapter();
  try {
    await raw.executeMultiple(LEGACY_SCHEMA);
    const passwordHash = hashPassword("legacy migration test password");
    const createdAt = "2025-01-17T08:00:00.000Z";
    const date = localDateTime(
      new Date(Date.now() + 30 * 86_400_000).toISOString(),
    ).slice(0, 10);
    const start = stockholmToIso(`${date}T09:00`);
    const end = stockholmToIso(`${date}T10:00`);
    await raw.execute({
      sql: "INSERT INTO users VALUES(17,?,?,?,?,?)",
      args: [
        "migration-admin@example.test",
        "Legacy Admin",
        passwordHash,
        "admin",
        createdAt,
      ],
    });
    await raw.execute(
      "INSERT INTO settings VALUES(1,'Legacy Tibb','legacy@example.test','123','Legacy address','Legacy location',1,0)",
    );
    await raw.execute(
      "INSERT INTO treatments VALUES(29,'Legacy treatment','Legacy description',60,73500,1)",
    );
    for (const [id, archived] of [
      [31, 0],
      [32, 1],
    ] as const) {
      await raw.execute({
        sql: "INSERT INTO slots VALUES(?,?,?,?,?)",
        args: [id, 29, start, end, archived],
      });
      await raw.execute({
        sql: "INSERT INTO bookings(id,reference,treatment_id,slot_id,treatment_name,duration_minutes,price_ore,start,end,name,email,phone,status,payment_method,payment_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [
          id + 10,
          `legacy-${id}`,
          29,
          id,
          "Original price snapshot",
          60,
          69000,
          start,
          end,
          "Migration Booking",
          "migration-booking@example.test",
          "987",
          archived ? "cancelled" : "confirmed",
          "onsite",
          "paid",
          createdAt,
        ],
      });
    }
    const usersBefore: Record<string, unknown>[] = (await raw.execute("SELECT * FROM users ORDER BY id"))
      .rows.map((row) => ({ ...row, email_verified_at: null }));
    const bookingsBefore = (
      await raw.execute("SELECT * FROM bookings ORDER BY id")
    ).rows;
    const slotsBefore = (await raw.execute("SELECT * FROM slots ORDER BY id"))
      .rows;
    const settingsBefore = (await raw.execute("SELECT * FROM settings")).rows;
    const migratedBookings = bookingsBefore.map((booking) => ({
      ...booking,
      practitioner_id: 1,
      practitioner_name: "Tibb.nu",
    }));
    raw.close();

    // Initialization is safe both concurrently and after a fresh adapter opens.
    await Promise.all([migrated.initialize(), migrated.initialize()]);
    assert.deepEqual(
      await migrated.prepare("SELECT * FROM users ORDER BY id").all(),
      usersBefore.map((row) => ({ ...row, supabase_id: null })),
    );
    assert.deepEqual(
      await migrated.prepare("SELECT * FROM bookings ORDER BY id").all(),
      migratedBookings,
    );
    assert.deepEqual(
      await migrated.prepare("SELECT * FROM settings").all(),
      settingsBefore,
    );
    assert.deepEqual(
      await migrated.prepare("SELECT * FROM slots ORDER BY id").all(),
      slotsBefore.map((slot) => ({
        ...slot,
        schedule_id: null,
        practitioner_id: 1,
      })),
    );
    assert.equal(
      (
        await migrated
          .prepare("SELECT name FROM practitioners WHERE id=1")
          .get()
      )?.name,
      "Tibb.nu",
    );
    assert.ok(
      verifyPassword(
        "legacy migration test password",
        String(usersBefore[0].password_hash),
      ),
    );
    assert.equal(
      (await migrated.prepare("PRAGMA table_info(slots)").all()).filter(
        (column) => column.name === "schedule_id",
      ).length,
      1,
    );
    const oldTrigger = await migrated
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name='treatments_preserve_history'",
      )
      .get();
    assert.ok(oldTrigger);
    assert.ok(!String(oldTrigger.sql).includes("availability_schedules"));
    assert.ok(
      await migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name='treatments_preserve_schedules'",
        )
        .get(),
    );
    await migrated.close();

    const db = getDb();
    await db.initialize();
    assert.deepEqual(
      await db.prepare("SELECT * FROM bookings ORDER BY id").all(),
      migratedBookings,
    );
    const legacySlot = (await getSlots()).find((slot) => slot.id === 31)!;
    assert.equal(legacySlot.scheduleId, null);
    assert.equal(legacySlot.practitionerId, 1);
    assert.equal(legacySlot.booked, true);
    const schedule = await saveAvailabilitySchedule(17, {
      treatmentId: 29,
      startDate: date,
      endDate: date,
      weekdays: [new Date(`${date}T12:00:00Z`).getUTCDay() || 7],
      startTime: "10:00",
      endTime: "12:00",
      breaks: [],
    });
    assert.equal(schedule.created, 2);
    assert.equal(
      (await getSlots()).filter((slot) => slot.scheduleId === schedule.id)
        .length,
      2,
    );
    assert.deepEqual(
      await db.prepare("SELECT * FROM bookings ORDER BY id").all(),
      migratedBookings,
    );
    assert.deepEqual(
      await db.prepare("SELECT * FROM users ORDER BY id").all(),
      usersBefore.map((row) => ({ ...row, supabase_id: null })),
    );

    // HTTP-backed connections cannot rely on foreign_keys pragmas; the new
    // guards must work even with an older history trigger still in place.
    await db.exec("PRAGMA foreign_keys=OFF");
    await assert.rejects(
      db.prepare("UPDATE slots SET practitioner_id=999999 WHERE id=31").run(),
      /Foreign key constraint|Slot has booking history/,
    );
    await assert.rejects(
      db.prepare("DELETE FROM practitioners WHERE id=1").run(),
      /Practitioner has booking history/,
    );
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO slots(treatment_id,start,end,schedule_id) VALUES(?,?,?,?)",
        )
        .run(29, start, end, 999999),
      /Foreign key constraint/,
    );
    await db
      .prepare(
        "INSERT INTO treatments(id,name,description,duration_minutes,price_ore,active) VALUES(43,'Schedule-only treatment','',60,100,1)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO availability_schedules(treatment_id,start_date,end_date,weekdays,start_time,end_time,breaks,created_at) VALUES(43,?,?,?,'13:00','14:00','[]',?)",
      )
      .run(date, date, "[1]", createdAt);
    await assert.rejects(
      db.prepare("DELETE FROM treatments WHERE id=43").run(),
      /Treatment has schedule history/,
    );
  } finally {
    raw.close();
    await migrated.close();
    await getDb().close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("tibb-availability-migration-"));
    await rm(directory, {
      recursive: true,
      force: true,
      // Windows can briefly retain a closed native SQLite file handle during
      // a concurrent suite. Retry only filesystem cleanup, never assertions.
      maxRetries: 12,
      retryDelay: 200,
    });
  }
});
