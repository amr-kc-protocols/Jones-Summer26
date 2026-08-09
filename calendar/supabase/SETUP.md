# Supabase setup — Jones Family Calendar

One-time setup. Takes about ten minutes. Do steps 1–4 now; step 5 needs the app,
which comes next.

---

## 1. Create the project

<https://supabase.com/dashboard> → **New project**

| Field | Value |
|---|---|
| Name | `jones-family-calendar` |
| Database password | Anything long. Save it in your password manager — you will not need it for the app. |
| Region | Whichever is closest to you |

Wait for it to finish provisioning (~2 min).

---

## 2. Run the schema

**SQL Editor** → **New query** → paste the entire contents of
[`schema.sql`](./schema.sql) → **Run**.

You should see `Success. No rows returned`. The script is safe to re-run if you
ever need to.

This creates four tables — `people`, `events`, `event_exceptions`,
`household_settings` — locks them all behind row-level security, and turns on
realtime so an edit on one phone shows up on the other without a refresh.

---

## 3. Close off public sign-ups

**Authentication** → **Sign In / Providers** → **Email**

- **Allow new users to sign up** → **off**

This matters. It means the only account that can ever exist is the one you
create in the next step. Without it, anyone who found the site could register
themselves an account and read the calendar.

---

## 4. Create the household account

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

The email address is never used for anything. It doesn't need to be real, and
nothing is ever sent to it.

> **Changing the PIN later:** Authentication → Users → the account → Reset
> password, and set it to `newPIN` + the same salt. No code change needed.

---

## 5. Wire up the app _(after the app is built)_

**Project Settings** → **API**, then copy two values into `calendar/config.js`:

- **Project URL** → `SUPABASE_URL`
- **Project API keys → `anon` `public`** → `SUPABASE_ANON_KEY`

Copy the **anon public** key, not `service_role`. The `service_role` key
bypasses row-level security entirely and must never go in a web page.

Both of these are fine to commit to a public repo — that is what the anon key is
designed for, and the RLS policies from step 2 are what actually protect the
data.

---

## What protects the calendar

- The anon key on its own returns nothing — every table requires an
  authenticated session.
- The only account that can authenticate is the household one, and public
  sign-up is off.
- Reaching that account requires the PIN.

The honest limit: a 4–6 digit PIN is short, and what stops someone guessing it
is Supabase's auth rate-limiting. That is a sensible trade for a family
calendar. Don't put anything genuinely sensitive — account numbers, passwords —
in an event's notes field.
