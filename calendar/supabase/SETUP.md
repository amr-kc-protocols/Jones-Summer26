# Supabase setup — Jones Family Calendar

The calendar keeps its tables in their own `calendar` schema, so it does **not**
need a Supabase project to itself. If you're at the free tier's two-project
limit, put it inside a project you already have — these steps are the same
either way.

One-time setup, about ten minutes. Steps 1–5 you can do now; step 6 needs the
app.

---

## 1. Pick a project

Either an existing one or a new one — it makes no difference to the calendar.
Everything it creates is namespaced under `calendar.`, so it won't collide with
tables another app has in `public`.

If you're creating a fresh project: **New project**, any name, save the database
password in your password manager (you won't need it for the app), pick the
nearest region, wait ~2 min for provisioning.

---

## 2. Run the schema

**SQL Editor** → **New query** → paste all of [`schema.sql`](./schema.sql) →
**Run**.

Expect `Success. No rows returned`, possibly with a few `NOTICE ... skipping`
lines — those are normal. The file is safe to re-run.

It creates the `calendar` schema with four tables — `people`, `events`,
`event_exceptions`, `household_settings` — locks them behind row-level
security, and turns on realtime.

---

## 3. Expose the schema to the API

**Project Settings** → **API** → **Exposed schemas** → add `calendar` alongside
`public` → save.

Without this the API can't see the tables and the app will report that every
table is missing.

---

## 4. Close off public sign-ups

**Authentication** → **Sign In / Providers** → **Email** →
**Allow new users to sign up** → **off**.

> Skip this if another app in the same project needs open sign-up. The
> calendar is safe either way — see *What protects the calendar* below — but
> turning it off is worth doing when nothing else needs it.

---

## 5. Create the household account

Pick a PIN — 4 to 6 digits, something you and Marloes will both remember.

**Authentication** → **Users** → **Add user** → **Create new user**

| Field | Value |
|---|---|
| Email | `family@jonescalendar.local` |
| Password | your PIN followed by `4_Cq8PkCaiuZi62ya65yN7EwSRGyPNWK` |
| Auto Confirm User | ✅ **on** |

So if your PIN is `4821`, the password you paste is exactly:

```
48214_Cq8PkCaiuZi62ya65yN7EwSRGyPNWK
```

No space, no separator. The long tail is a fixed salt that also lives in the
app's config — the app appends it to whatever PIN you type, so on your phones
you only ever enter the four digits.

That address is never used for anything. It doesn't need to be real, nothing is
sent to it, and it's the address the security policies key on — so use it
exactly as written, or change it in **both** `schema.sql` (in the
`calendar.is_household()` function) and `config.js`.

> **Changing the PIN later:** Authentication → Users → the account → Reset
> password, and set it to `newPIN` + the same salt. No code change needed.

---

## 6. Wire up the app

**Project Settings** → **API**, then copy two values into `calendar/config.js`:

- **Project URL** → `SUPABASE_URL`
- **Project API keys → `anon` `public`** → `SUPABASE_ANON_KEY`

Copy the **anon public** key, not `service_role`. The `service_role` key
bypasses row-level security entirely and must never go in a web page.

Both values are safe to commit. The anon key is designed to be public; the
policies from step 2 are what actually protect the data.

---

## What protects the calendar

Auth is shared across a whole Supabase project. "Is logged in" is therefore
*not* a safe test when the project also hosts another app — any user of that
app would pass it. So every policy requires one specific account:

```sql
coalesce(auth.jwt() ->> 'email', '') = 'family@jonescalendar.local'
```

Which gives three layers:

- The anon key alone reads nothing — `anon` has no grant on the schema at all.
- Any *other* signed-in user of the same project sees zero rows and is refused
  on insert, update and delete.
- Reaching the household account requires the PIN.

This was verified against a real Postgres instance, not just reasoned about:
signed in as the household account all four tables read and write normally;
signed in as `someone.else@example.com` every table returns zero rows, inserts
are rejected by the policy, and updates and deletes touch nothing.

The honest limit: a 4–6 digit PIN is short, and what stops someone guessing it
is Supabase's auth rate-limiting. That's a sensible trade for a family
calendar. Don't put anything genuinely sensitive — account numbers, passwords —
in an event's notes field.

---

## If you'd rather not share a project

Nothing here is Supabase-specific beyond the client library. If you later want
the calendar somewhere else, the closest free equivalents are **Firebase**
(built-in auth plus realtime, so the data layer in `app.js` maps over fairly
directly) or **Cloudflare D1 + Workers** (SQLite plus a small API you'd write).
Both mean rewriting `app.js`'s data layer; sharing a project doesn't.
