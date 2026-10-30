# MOA Shift Scheduler — MVP

## Purpose
Web app for ONE BC medical clinic. A manager builds a weekly MOA shift
schedule, sees coverage gaps and BC Employment Standards warnings live,
publishes it, and staff view their shifts on their phones.

## Stack (do not change without asking)
- Cloudflare Pages (front end), Workers (API), D1 (SQLite database)
- Plain HTML/CSS/JS, no framework. Mobile-first staff view.
- Login via Cloudflare Access; read the user's email from the Access header.
- Times stored as ISO local time, America/Vancouver.

## Roles
- manager: full access, builds and publishes schedules, approves time off
- staff: sets own availability, requests time off, views published schedule

## Rules engine (src/rules.js) — pure functions, fully unit-tested
Each rule returns { ok, code, message, shiftIds }. Rules WARN; they never block a save.
- REST_8H: >= 8 consecutive hours off between shifts for each person
- SPLIT_12H: all segments of a split day finish within 12 h of the first start
- MIN_2H: no shift shorter than 2 hours
- MEAL_5H: a 30-min meal break is planned in any shift over 5 hours
- OT_DAY: more than 8 h worked in a day
- OT_WEEK: more than 40 h worked in a week (Sun–Sat)
- SKILL: assigned person lacks the station's required skill
- AVAIL: shift falls outside the person's availability or approved time off
- COVERAGE: scheduled MOAs per block < providers × ratio (setting, default 0.5)
- DESK_EMPTY: a front-desk block has no one on it (e.g. during lunch)

## Out of scope for MVP
Shift swaps, open-shift pickup, SMS replacement offers, multiple clinics
(keep clinic_id columns), provinces other than BC, payroll integration,
EMR sync, AI-generated schedules.

## Privacy
Staff data only. Never store patient information.

## Working style
- One milestone per session. Write tests before UI for the rules engine.
- Keep files small; explain schema changes before making them.
- Commit after each passing milestone with a clear message.

## Milestones
1. Repo, Cloudflare setup, D1 schema and seed data for a fake 6-MOA clinic. ✅
2. Rules engine with unit tests for every rule above. ✅
3. Admin screens: staff, skills, stations, clinic settings. ✅
4. Manager weekly grid with live warnings and coverage bar.
5. Staff view: availability entry, time-off request, "my shifts" on mobile.
6. Time-off approval, publish with email notice, CSV export of hours.
7. Cloudflare Access login and role checks; deploy to production.

## Commands
- `npm test` — rules engine unit tests (node:test, no dependencies)
- `npm run db:reset:local` — apply migrations and seed to the local D1 database
- `npm run dev` — local Worker + static front end via wrangler
