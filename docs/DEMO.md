# Public demo copy (password sign-in)

A second copy of the app for showing to prospective clinics. It runs as its own
Worker (`moa-scheduler-demo`) with its own D1 database, so nothing a visitor does
touches the production app. Visitors don't need Cloudflare Access: they open the
address, type a user ID and the shared demo password, and they're in.

| User ID | Signs in as |
|---|---|
| `manager` | Morgan Lee, the manager: weekly grid, Clinic setup, publish, "view as" |
| `priya`, `jordan`, `ana`, `sam`, `riley`, `dee` | a staff member's phone view |

Everyone shares one password, kept as a Worker secret (never in the repo or database).
The first sign-in on an empty database creates the fictional "Maple Grove Clinic (demo)"
and fills it with a sample schedule around the current week. **Clinic setup → Reset demo
data** puts it back after visitors have changed things.

## One-time setup (about 10 minutes)
From the repo folder, signed in with `npx wrangler login`:

1. Create the demo database and paste the `database_id` it prints into `wrangler.toml`,
   replacing `REPLACE_WITH_DEMO_DATABASE_ID` under `[env.demo]`. Commit that change.
   ```
   npx wrangler d1 create moa-scheduler-demo
   ```
2. Deploy once (creates the Worker), either with **Actions → Deploy → Run workflow**,
   target **demo**, or:
   ```
   npx wrangler d1 migrations apply moa-scheduler-demo --remote --env demo
   npx wrangler deploy --env demo
   ```
3. Set the shared password (it asks you to type it; pick something you're happy to give out):
   ```
   npx wrangler secret put DEMO_PASSWORD --env demo
   ```
4. Open `https://moa-scheduler-demo.<your-subdomain>.workers.dev` and sign in as `manager`.

If the address asks for a Cloudflare Access code instead of showing the sign-in page,
your Access application covers all `*.workers.dev` addresses: edit it in Zero Trust so it
only lists the production address.

## Day to day
- **Change the password:** run step 3 again. Everyone signed in is signed out.
- **Update the demo after a merge:** run the Deploy workflow with target **demo**.
  Production is deployed separately (target **production**, the default).

## How it's kept apart from production
- Password sign-in only works when `AUTH_MODE = "password"` (set only under `[env.demo]`)
  **and** Cloudflare Access isn't configured. Production has Access, so it can never use it.
- Sessions are an HttpOnly, Secure cookie signed with a key derived from the password,
  valid for 7 days. No passwords are stored in the database.
- The demo is meant for fictional data only. Since anyone with the password can sign in
  as the manager, don't put real staff or clinic details in it.
