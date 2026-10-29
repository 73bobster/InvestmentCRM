# Investment CRM

An internal mini-CRM and investment tracker for Alchemy Drinks.

- **Brand owners** (gold, money in): owner > brand > product.
- **Customers** (teal, money out): group > sub-group(s) > pub or outlet (four levels at most).
- Key contacts, meetings, notes, decisions, tasks, investments (one type with a *kind*), exclusivity, volume targets (no actuals), manually recorded shortfalls, diary and reminders.
- Every note, call, email, meeting, visit or decision must end with a **revisit** task or a **reason and comment** for none. Closing a task works the same way.
- Everything changed is in the audit log. Nothing is deleted: records are archived.
- Roles: Superuser, Admin (read and write), Review only. Everyone sees everything in their organisation.

Plain HTML, CSS and JavaScript modules: no build step. Same look, feel and structure as FleetRecord (see the starter kit).

## How it is put together

| Part | What |
|---|---|
| Front end | `index.html`, `*.js`, `theme.css`, `app.css`. Published by GitHub Pages (`.github/workflows/pages.yml`). |
| Database | Neon Postgres. `migrations/` are applied in order. All rules are in the database (row-level security, functions), not the screens. |
| Sign-in | Neon Auth (cookie session, a 15-minute token is sent with each request). |
| Records | Neon Data API (PostgREST) with row-level security. |
| `config.js` | Public web addresses only. Never put a password or connection string in it. |

## Database

1. `migrations/0001_core.sql`: organisations, users, invitations, audit log, security helpers.
2. `migrations/0002_crm.sql`: parties, contacts, investments, payments, targets, reviews, entries, tasks, reminders, roll-up views.
3. `migrations/0003_demo_support.sql`: demo helper.
4. `seed/demo.sql`: fictional demo organisation (replace `__OWNER_EMAIL__`).

Apply with `tools/apply-sql.mjs`. Create an organisation (owner only, from the SQL editor):

```sql
select public.create_organisation('Alchemy Drinks', 'alchemy-drinks', 'someone@example.com');
```

It returns an invitation token. The person opens `https://YOUR-SITE/?invite=TOKEN`, creates an account with that email address and becomes the superuser. Further users are invited from Settings.

## Known limits

- Neon Auth uses a cookie from another site. Safari on iPhone may block it; if so, put the app and a small proxy on the same domain.
- No forgot-password screen yet. No subscribed calendar feed yet (the Diary has a calendar file download).
- Add the site's address as a trusted origin in Neon Auth.
