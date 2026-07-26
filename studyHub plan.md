# StudyHub 2.0 — Backend Plan

**Project:** StudyHub2.0 (new, separate Supabase project — get the new project's URL + `project_id` from Dashboard → Settings → API and send it over before we run anything)
**Status:** Planning — nothing has been run against the new project yet
**Goal:** One coherent backend, designed once, matching the Stitch UI exactly. No mixing with the old project or the Gemini-generated schema.

---

## 0. Why we're starting clean

The old StudyHub DB and the Gemini-generated SH2.0 attempt used different structural conventions (naming, RLS strategy, view design), which made them hard to merge. Rather than reconcile two different philosophies, we design SH2.0 once, end-to-end, applying what we learned from the old build:

- Flatten columns into views instead of relying on PostgREST relationship embedding (unreliable through views).
- `security_invoker = true` on every view, always — otherwise views silently run with elevated privileges.
- Harden every `SECURITY DEFINER` function with `set search_path = public`.
- Award gamification points on **moderation approval**, not on submission — prevents spam-farming XP.
- Private storage bucket + signed URLs only. Never `getPublicUrl()` on a private bucket.
- When removing a broad storage/table policy, add its narrower replacement in the **same migration** — never leave a gap where nothing can read.
- Don't revoke `EXECUTE` on helper functions used inside RLS policies (like `current_role()`) from the `authenticated` role — it breaks RLS everywhere, silently.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite + Tailwind v4 (Stitch export) |
| Backend | Supabase (Postgres, Auth, Storage, RLS) |
| Auth | Real Supabase Auth (email + password) |
| File storage | Private Supabase Storage bucket, signed URLs |
| AI (optional, TBD) | Gemini API — only if we wire up auto-summarization (see §7) |

---

## 2. Data model

### `profiles`
One row per `auth.users` row, auto-created on signup.

| column | type | notes |
|---|---|---|
| id | uuid PK | = auth.users.id |
| full_name | text | from signup form or email prefix |
| email | text | snapshotted from auth.users |
| points | int | XP; starts at 200 (signup bonus) |
| role | text | `student` \| `moderator` \| `admin` |
| created_at | timestamptz | |

### `universities`
Powers "Browse by University" pills + upload form dropdown.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text unique | e.g. "AASTU" |
| slug | text unique | |

Seed: AASTU, AAU. Add more anytime — no code changes needed.

### `materials`
The core document records.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| uploader_id | uuid FK → profiles | nullable (set null if user deleted) |
| university_id | uuid FK → universities | required |
| course_code | text | e.g. "CS101" |
| title | text | |
| description | text | |
| content_snippet | text | "Interactive Draft Preview" text |
| material_type | text | `lecture` \| `exam` \| `guide` |
| file_path | text | storage object path |
| file_name | text | original filename, for display |
| author_display_name | text | snapshotted at upload (see §4) |
| status | text | `pending` \| `approved` \| `rejected`, default `pending` |
| reviewed_by | uuid FK → profiles | moderator who reviewed |
| reviewed_at | timestamptz | |
| rejection_reason | text | |
| downloads_count | int | default 0 |
| created_at | timestamptz | |

### `ratings`
One star rating per user per material.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| material_id | uuid FK → materials | |
| user_id | uuid FK → profiles | |
| stars | smallint | 1–5 |
| unique(material_id, user_id) | | one rating per user per doc |

### View: `materials_with_stats`
Flattens `materials` + `universities.name` + live `avg(stars)`/`count(stars)` from `ratings`, so the frontend never needs relationship-embedding. `security_invoker = true`.

---

## 3. Auth & roles

- Real Supabase Auth: email + password, session persisted client-side via `supabase-js`.
- `handle_new_user()` trigger on `auth.users` insert → creates the `profiles` row, grants 200 XP signup bonus.
- Roles: `student` (default), `moderator` (can approve/reject uploads), `admin` (full control + can promote others).
- `prevent_self_role_escalation` trigger blocks anyone but an admin from changing a `role` column value — even via a direct API call.
- To make your own account an admin after first signup: one manual SQL command (in the seed file) — can't be done through the UI, by design.

---

## 4. Upload + moderation flow

1. Student fills out the upload form (course, title, description, type, university, optional content snippet, optional contributor name override) **and attaches a real file**.
2. File uploads to the private `materials` bucket at path `{user_id}/{timestamp}-{filename}`.
3. A `materials` row is inserted with `status = 'pending'`. If "Contributor Name" was left blank, a trigger snapshots the uploader's `profiles.full_name` onto the row automatically — this means the frontend never has to query other users' profile data directly, which keeps RLS simple and avoids exposing emails.
4. Material sits in a moderation queue, visible only to the uploader + moderators/admins.
5. A moderator approves or rejects. On approval:
   - `status → 'approved'`, row becomes publicly visible.
   - Trigger fires: uploader gets **+50 XP**.
6. On rejection: `status → 'rejected'`, `rejection_reason` optionally set, visible to uploader only (so they know why).

---

## 5. Download flow (signed URLs)

Because the bucket is private:

1. Frontend calls `supabase.storage.from('materials').createSignedUrl(path, 60)` — never `getPublicUrl()`.
2. Storage RLS allows this only if: it's the user's own upload, OR the material is `approved`, OR the caller is a moderator/admin.
3. On successful download, frontend calls the `increment_downloads(material_id)` RPC (a `SECURITY DEFINER` function) to bump `downloads_count` — students don't get direct `UPDATE` rights on materials they didn't upload, so this has to go through a controlled function rather than a raw table update.
4. Any file path pulled back out of a URL gets `decodeURIComponent()`'d before use — encoded spaces caused 400s last time.

---

## 6. RLS summary

| Table | Public/anon | Authenticated (own) | Moderator/Admin |
|---|---|---|---|
| `profiles` | none | read/update own row | read all, admin can update any |
| `universities` | read all | read all | admin can write |
| `materials` | read `approved` only | read/edit/delete own `pending` rows, insert new | read/update all (moderate) |
| `ratings` | read all | insert/update/delete own | — |
| storage: `materials` bucket | — | read own + approved files, upload to own folder | read all (for review queue) |

---

## 7. Open decision: AI-powered content preview

Your `package.json` already includes `@google/genai`, and the mockup's "Copy Notes Draft" / "Interactive Draft Preview" reads like it's meant to auto-summarize the uploaded file rather than have the student type it manually.

Two paths:
- **A — Manual (simpler, ships today):** `content_snippet` stays a plain text field the uploader types themselves.
- **B — AI-generated (more work, matches mockup's spirit):** after upload, call Gemini server-side (Supabase Edge Function, so the API key never touches the client) to extract/summarize text from the file into `content_snippet`.

*Recommendation: ship with A today, add B as a fast-follow once the core flow is solid — an Edge Function is a self-contained addition and won't require touching this schema.*

---

## 8. Build order (migrations)

1. `001_extensions.sql` — enable `pgcrypto`
2. `002_tables.sql` — profiles, universities, materials, ratings
3. `003_functions_triggers.sql` — role checks, signup trigger, XP trigger, download counter, author-name snapshot
4. `004_views.sql` — `materials_with_stats`
5. `005_rls_policies.sql` — RLS for every table
6. `006_storage.sql` — private bucket + storage policies
7. `007_seed.sql` — seed universities, admin-promotion instructions

Each runs standalone in the SQL Editor, in order, on the **new** SH2.0 project.

---

## 9. Frontend pieces needed

- `src/lib/supabaseClient.ts` — singleton client, reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- `src/lib/storage.ts` — `uploadMaterialFile()`, `getSignedDownloadUrl()`, `recordDownload()`
- `.env.local` — SH2.0 project URL + anon key (not the old project's)
- `npm install @supabase/supabase-js`

---

## 10. Today's checklist

- [ ] Confirm SH2.0 Supabase project URL + anon key
- [ ] Confirm decision on §7 (AI content preview: A or B)
- [ ] Run migrations 001 → 007 in SH2.0's SQL Editor
- [ ] Install `@supabase/supabase-js`, add env vars, drop in client + storage helper files
- [ ] Sign up once through the app, then promote yourself to `admin`
- [ ] Wire up: signup/login, browse (reads `materials_with_stats`), upload form (real file + insert), material detail modal (signed URL download + rating), moderation queue page
- [ ] Test the full loop: upload → appears in moderation queue → approve → appears in Browse → download → XP awarded

---

## Questions before I generate the actual SQL files for SH2.0

1. What's the new project's URL / project ref?
2. §7 — manual content snippet for now, or build the Gemini Edge Function today too?
3. Anything from the Gemini-generated version worth keeping (any table/column naming you liked), or fully my call on structure?
