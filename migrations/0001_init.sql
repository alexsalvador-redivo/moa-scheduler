-- MOA Shift Scheduler: initial schema.
-- Dates are 'YYYY-MM-DD', times are 'HH:MM', all local America/Vancouver time.
-- Every clinic-owned table carries clinic_id so multi-clinic can come later.

CREATE TABLE clinics (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  -- JSON: {"1":["08:00","20:00"], ...} keyed by weekday (0 = Sunday)
  open_hours      TEXT    NOT NULL DEFAULT '{}',
  coverage_ratio  REAL    NOT NULL DEFAULT 0.5,
  week_starts_on  INTEGER NOT NULL DEFAULT 0 CHECK (week_starts_on BETWEEN 0 AND 6)
);

CREATE TABLE staff (
  id                INTEGER PRIMARY KEY,
  clinic_id         INTEGER NOT NULL REFERENCES clinics(id),
  name              TEXT    NOT NULL,
  email             TEXT    NOT NULL UNIQUE,
  role              TEXT    NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff')),
  staff_type        TEXT    NOT NULL CHECK (staff_type IN ('FT', 'PT', 'casual')),
  min_weekly_hours  REAL    NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE skills (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE staff_skills (
  staff_id  INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  skill_id  INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, skill_id)
);

CREATE TABLE stations (
  id                 INTEGER PRIMARY KEY,
  clinic_id          INTEGER NOT NULL REFERENCES clinics(id),
  name               TEXT    NOT NULL,
  required_skill_id  INTEGER REFERENCES skills(id),
  is_front_desk      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE availability (
  id          INTEGER PRIMARY KEY,
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  TEXT    NOT NULL,
  end_time    TEXT    NOT NULL
);

CREATE TABLE time_off (
  id          INTEGER PRIMARY KEY,
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,
  reason      TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined'))
);

CREATE TABLE provider_blocks (
  id              INTEGER PRIMARY KEY,
  clinic_id       INTEGER NOT NULL REFERENCES clinics(id),
  date            TEXT    NOT NULL,
  start_time      TEXT    NOT NULL,
  end_time        TEXT    NOT NULL,
  provider_count  INTEGER NOT NULL CHECK (provider_count >= 0)
);

CREATE TABLE shifts (
  id           INTEGER PRIMARY KEY,
  clinic_id    INTEGER NOT NULL REFERENCES clinics(id),
  staff_id     INTEGER NOT NULL REFERENCES staff(id),
  station_id   INTEGER NOT NULL REFERENCES stations(id),
  date         TEXT    NOT NULL,
  start_time   TEXT    NOT NULL,
  end_time     TEXT    NOT NULL,
  break_start  TEXT,
  break_end    TEXT,
  status       TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'))
);

CREATE TABLE schedule_weeks (
  id            INTEGER PRIMARY KEY,
  clinic_id     INTEGER NOT NULL REFERENCES clinics(id),
  week_start    TEXT    NOT NULL,
  published_at  TEXT,
  UNIQUE (clinic_id, week_start)
);

CREATE INDEX idx_shifts_clinic_date ON shifts (clinic_id, date);
CREATE INDEX idx_shifts_staff_date  ON shifts (staff_id, date);
CREATE INDEX idx_blocks_clinic_date ON provider_blocks (clinic_id, date);
CREATE INDEX idx_time_off_staff     ON time_off (staff_id, start_date);
