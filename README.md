# MOA Shift Scheduler

Weekly MOA shift scheduling for one BC clinic. A manager builds the week, the app flags
coverage gaps and BC Employment Standards issues as warnings, and staff see their
published shifts on their phones. Runs on Cloudflare Workers + D1 at about $0/month.

See `CLAUDE.md` for scope, rules and milestones.

## Status
- Milestone 1: D1 schema (`migrations/`), seed clinic with 6 MOAs + manager (`seed.sql`), Worker + static front end.
- Milestone 2: rules engine (`src/rules.js`) with unit tests for spec test cases 1–12 (`test/`).
- Milestone 3: clinic setup screen at `/admin.html` (clinic hours and ratio, staff, stations, skills) backed by `src/admin.js`.
- Milestone 4: manager weekly grid at `/` with live warnings, a coverage bar per day, provider counts, and copy last week (`src/schedule.js`, `public/grid.js`).

## Run locally
```
npm install
npm test                 # rules engine tests
npm run db:reset:local   # create local D1 tables and seed data
npm run dev              # http://localhost:8787
```
`GET /api/check?week=2026-11-01` returns the week's shifts and every rule warning.
Admin API: `GET/PUT /api/clinic`, and `GET/POST /api/{staff,stations,skills}` plus `PUT/DELETE /api/{...}/:id`.
Removing a person deactivates them so past shifts keep their owner.
Schedule API: `GET /api/week?date=`, `POST /api/shifts`, `PUT/DELETE /api/shifts/:id`, `POST /api/week/copy`, `PUT /api/week/blocks`. Each write returns the refreshed week with warnings and coverage.

## Deploy (first time)
```
npx wrangler login
npx wrangler d1 create moa-scheduler   # paste the database_id into wrangler.toml
npm run db:migrate
npx wrangler d1 execute moa-scheduler --remote --file=seed.sql   # optional demo data
npm run deploy
```
