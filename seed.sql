-- Seed data: a fake family practice + walk-in clinic with 6 MOAs and a manager.
-- Draft schedule for the week of Sun 2026-11-01 to Sat 2026-11-07.
-- All names and emails are fictional.

INSERT INTO clinics (id, name, open_hours, coverage_ratio, week_starts_on) VALUES
  (1, 'Maple Grove Family Practice',
   '{"1":["08:00","20:00"],"2":["08:00","20:00"],"3":["08:00","20:00"],"4":["08:00","20:00"],"5":["08:00","20:00"],"6":["09:00","15:00"]}',
   0.5, 0);

INSERT INTO skills (id, name) VALUES
  (1, 'Front desk'),
  (2, 'Triage'),
  (3, 'EMR'),
  (4, 'MSP billing'),
  (5, 'Open/close');

INSERT INTO stations (id, clinic_id, name, required_skill_id, is_front_desk) VALUES
  (1, 1, 'Front desk',      1, 1),
  (2, 1, 'Phones / triage', 2, 0),
  (3, 1, 'Back office',     3, 0),
  (4, 1, 'Billing',         4, 0);

INSERT INTO staff (id, clinic_id, name, email, role, staff_type, min_weekly_hours) VALUES
  (1, 1, 'Morgan Lee',     'manager@example.test', 'manager', 'FT',     0),
  (2, 1, 'Priya Sandhu',   'priya@example.test',   'staff',   'FT',     37.5),
  (3, 1, 'Jordan Chen',    'jordan@example.test',  'staff',   'FT',     37.5),
  (4, 1, 'Ana Ferreira',   'ana@example.test',     'staff',   'PT',     24),
  (5, 1, 'Sam Okafor',     'sam@example.test',     'staff',   'PT',     20),
  (6, 1, 'Riley Tremblay', 'riley@example.test',   'staff',   'casual', 0),
  (7, 1, 'Dee Nguyen',     'dee@example.test',     'staff',   'casual', 0);

INSERT INTO staff_skills (staff_id, skill_id) VALUES
  (2, 1), (2, 2), (2, 3), (2, 4), (2, 5),  -- Priya: senior, does everything
  (3, 1), (3, 3), (3, 5),                  -- Jordan: desk, EMR, opens
  (4, 1), (4, 2),                          -- Ana: desk, triage
  (5, 3), (5, 4),                          -- Sam: back office and billing
  (6, 1),                                  -- Riley: desk only
  (7, 1), (7, 3);                          -- Dee: desk and EMR

-- Recurring availability (weekday 0 = Sunday). FT staff left open.
INSERT INTO availability (staff_id, weekday, start_time, end_time) VALUES
  (4, 1, '08:00', '16:30'), (4, 2, '08:00', '16:30'), (4, 4, '08:00', '16:30'),
  (5, 2, '12:00', '20:00'), (5, 3, '12:00', '20:00'), (5, 5, '08:00', '16:30'),
  (6, 6, '09:00', '15:00'),
  (7, 1, '12:00', '20:00'), (7, 3, '12:00', '20:00'), (7, 6, '09:00', '15:00');

INSERT INTO time_off (staff_id, start_date, end_date, reason, status) VALUES
  (3, '2026-11-06', '2026-11-06', 'Appointment', 'approved'),
  (6, '2026-11-14', '2026-11-14', 'Family event', 'pending');

-- Providers on site: 4 in the day block, 2 in the evening block, 2 on Saturday.
INSERT INTO provider_blocks (clinic_id, date, start_time, end_time, provider_count) VALUES
  (1, '2026-11-02', '08:00', '16:30', 4), (1, '2026-11-02', '16:30', '20:00', 2),
  (1, '2026-11-03', '08:00', '16:30', 4), (1, '2026-11-03', '16:30', '20:00', 2),
  (1, '2026-11-04', '08:00', '16:30', 4), (1, '2026-11-04', '16:30', '20:00', 2),
  (1, '2026-11-05', '08:00', '16:30', 4), (1, '2026-11-05', '16:30', '20:00', 2),
  (1, '2026-11-06', '08:00', '16:30', 4), (1, '2026-11-06', '16:30', '20:00', 2),
  (1, '2026-11-07', '09:00', '15:00', 2);

INSERT INTO schedule_weeks (clinic_id, week_start, published_at) VALUES
  (1, '2026-11-01', NULL);

-- A partial draft for Monday so the grid has something to show.
INSERT INTO shifts (clinic_id, staff_id, station_id, date, start_time, end_time, break_start, break_end, status) VALUES
  (1, 3, 1, '2026-11-02', '08:00', '16:30', '12:00', '12:30', 'draft'),
  (1, 2, 4, '2026-11-02', '08:00', '16:30', '12:30', '13:00', 'draft'),
  (1, 4, 2, '2026-11-02', '08:00', '16:30', '11:30', '12:00', 'draft'),
  (1, 7, 1, '2026-11-02', '12:00', '20:00', '16:00', '16:30', 'draft');
