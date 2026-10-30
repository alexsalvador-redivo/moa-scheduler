# Deploying the MOA Shift Scheduler

Everything here runs on Cloudflare's free plan (Workers, D1, and Zero Trust Access for up to 50 users).
It takes about 30 minutes the first time. Steps 1–5 are done once.

## 1. Create the database
```
npm install
npx wrangler login
npx wrangler d1 create moa-scheduler
```
Copy the `database_id` it prints into `wrangler.toml`, then create the tables:
```
npx wrangler d1 migrations apply moa-scheduler --remote
```

## 2. Add the real clinic and its manager
`seed.sql` is a fake demo clinic. For the real one, add at least the clinic and one manager
(their email must match how they sign in), then use **Clinic setup** in the app for the rest:
```
npx wrangler d1 execute moa-scheduler --remote --command \
  "INSERT INTO clinics (id, name) VALUES (1, 'Your Clinic Name');
   INSERT INTO staff (clinic_id, name, email, role, staff_type) VALUES (1, 'Manager Name', 'manager@yourclinic.ca', 'manager', 'FT');"
```

## 3. Deploy once to get the app's address
```
npx wrangler deploy
```
It prints a `*.workers.dev` address. You can also attach your own domain in the
Cloudflare dashboard (Workers → moa-scheduler → Settings → Domains & Routes).

## 4. Put Cloudflare Access in front of it
In the Cloudflare dashboard, open **Zero Trust** (pick the free plan and a team name if asked).
1. **Settings → Authentication**: keep **One-time PIN** (staff get a code by email; no passwords).
2. **Access → Applications → Add an application → Self-hosted**.
   - Domain: the app's address from step 3 (and your own domain, if you added one).
   - Session duration: 1 month is comfortable for phones.
3. Add a policy **Allow**, include **Emails** (list each staff email) or **Emails ending in** `@yourclinic.ca`.
4. Save, then copy the application's **Audience (AUD) tag** from its Overview page.
5. In `wrangler.toml` under `[vars]`, set `ACCESS_TEAM_DOMAIN` to `yourteam.cloudflareaccess.com`
   and `ACCESS_AUD` to that tag. Set `APP_URL` to the address people will use.

The app checks Access's signed token on every request, so even someone who reaches the
Worker without going through Access gets nothing.

## 5. Email notices (optional)
Create a free [Resend](https://resend.com) account, verify your sending domain, then:
```
npx wrangler secret put RESEND_API_KEY
```
and set `MAIL_FROM` in `wrangler.toml`. Without this, publishing still works; the app just says no email was sent.

## 6. Deploy
Commit the `wrangler.toml` changes, then either run `npx wrangler deploy`, or deploy from GitHub:
add repository secrets `CLOUDFLARE_API_TOKEN` (a token with the "Edit Cloudflare Workers" template plus D1 edit)
and `CLOUDFLARE_ACCOUNT_ID`, then run **Actions → Deploy → Run workflow**.

## Check it
- Open the app: Access asks for your email and a code, then the weekly grid loads.
- A staff email lands on **My shifts**; the grid and Clinic setup tell them they're for managers.
- `https://<app>/api/health` returns `{"ok":true}`.
