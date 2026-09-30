# ID Life Dashboard

## Files

- index.html — UI + auth flow
- style.css — responsive dashboard styling
- app.js — Supabase authentication and database-backed dashboard
- cloud-config.js — public Supabase URL and anon key configuration
- supabase.sql — Supabase Auth profiles, tasks, friends, RLS, and legacy import setup
- schema.sql — separate MySQL backend draft; not used by this frontend

## Run

Open index.html directly, or use a local server for browser storage and location permissions:
python -m http.server 5500
then open http://localhost:5500/

## Setup

GitHub Pages hosts the frontend but does not provide a database. Configure Supabase before using the app:

1. Create a Supabase project.
2. Confirm the existing `public.students` table has `student_id`, `student_prefix`, `student_first_name`, `student_last_name`, and `student_birth`. Run `supabase.sql` in the Supabase SQL Editor. It creates profiles, tasks, friends, RLS policies, rate limiting, and private avatar storage; the auth trigger copies an authorized student row into the profile.
3. Copy the Supabase Project URL and the public anon/publishable key into `cloud-config.js`.
4. Install the Supabase CLI. From the project root, run `supabase login`, `supabase link --project-ref PROJECT_REF`, then `supabase functions deploy student-login`. `supabase/config.toml` keeps JWT verification enabled. The Supabase CLI supplies its URL, anon key, and service-role key as server environment variables; never copy the service-role key into this frontend.
5. In Supabase Authentication URL Configuration, set Site URL to `https://USERNAME.github.io/REPOSITORY/` and add Redirect URLs for `http://localhost:5500/**` and `https://USERNAME.github.io/REPOSITORY/**`.
6. Push the project to GitHub and enable Pages for the branch and folder containing `index.html`.
7. Add each permitted student through the school/admin process to `public.students`. The login function queries `student_id` and `student_birth` on the server, rate-limits attempts, and creates a Supabase Auth session only when the row matches. No separate Auth user or self-signup is required.

Login permits up to 8 attempts per student and, when the Supabase gateway provides a client IP header, 8 attempts per IP in a rolling 15-minute window. A successful match resets that student's counter. If no client IP header is available, rate limiting falls back to the student ID so all users are not grouped under one `unknown` address. Redeploy `student-login` after changing the function; the existing deployment keeps its old rate-limit behavior until updated.

When the authorized account for student ID `6612247052` first logs in from a browser with old `idLifeV1` data, optional Profile fields (bio, major, faculty, location, and avatar) are imported once. The name and birth date from `students` remain authoritative. A database claim prevents importing the backup into another account; the old browser data is retained and is not used for normal app operations. No legacy Tasks or Friends were present in the checked browser profile.

Only the public anon/publishable key belongs in `cloud-config.js`. Never put a Supabase `service_role` key in frontend code or GitHub. Keep `students` private with RLS; the Edge Function queries it server-side and the browser cannot query student records directly. Profile/task/friend policies restrict app data to the signed-in owner.

Profile fields, location settings, avatars, daily tasks, and friends are stored in Supabase and scoped to the signed-in account. Progress charts are computed from database tasks. If Supabase is not configured, login stays disabled; there is no local Demo mode or public signup.

## Production security

Cloud mode uses Supabase Auth and row-level security for profile, task, friend, and avatar access. DOB matching runs in the Edge Function and the service-role key stays server-side. DOB still has low entropy, so retain rate limiting and consider an admin-issued password or stronger second factor before handling sensitive production data. Keep the site on HTTPS and review RLS policies before publishing. The MySQL `schema.sql` is a separate backend design and is not used by this frontend.
