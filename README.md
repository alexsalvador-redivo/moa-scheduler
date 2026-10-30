# MOA Shift Scheduler

Weekly MOA shift scheduling for one BC clinic. A manager builds the week, the app flags
coverage gaps and BC Employment Standards issues as warnings, and staff see their
published shifts on their phones. Runs on Cloudflare Workers + D1 at about $0/month.

See `CLAUDE.md` for scope, rules and milestones.

## Status
- Milestone 1: D1 schema (`migrations/`), seed clinic with 6 MOAs + manager (`seed.sql`), Worker + static front end.
- Milestone 2: rules engine (`src/rules.js`) with unit tests for spec test cases 1–12 (`test/`).

## Run locally
```
npm install
npm test                 # rules engine tests
npm run db:reset:local   # create local D1 tables and seed data
npm run dev              # http://localhost:8787
```
`GET /api/check?week=2026-11-01` returns the week's shifts and every rule warning.

## Deploy (first time)
```
npx wrangler login
npx wrangler d1 create moa-scheduler   # paste the database_id into wrangler.toml
npm run db:migrate
npx wrangler d1 execute moa-scheduler --remote --file=seed.sql   # optional demo data
npm run deploy
```
