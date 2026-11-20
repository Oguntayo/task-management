# Workline

A multi-tenant work management and accountability platform: planned commitments with PM approval,
unplanned/urgent work as an independently reviewed record, AI-advisory estimates and deadline
guidance (never the final say), an immutable activity history, and company "products" whose
progress the AI updates from staff updates — never on its own say-so about what counts as progress.

**Status: written and logic-tested, not yet run.** See [Implementation report](#implementation-report)
at the end of this file for exactly what has and hasn't been verified, and why.

## Stack

Next.js 15 (App Router, Server Actions) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, RLS) ·
Cloudinary (signed uploads) · Nodemailer (Gmail SMTP) · Zod + React Hook Form · a provider-agnostic
AI module (Anthropic / OpenAI / any OpenAI-compatible endpoint, with a heuristic fallback when unset).

## 1. Install

```bash
npm install
```

## 2. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the four migrations **in order** (each is idempotent-ish but assumes the
   previous one ran first):
   ```
   supabase/migrations/0001_schema.sql
   supabase/migrations/0002_functions_triggers.sql
   supabase/migrations/0003_rls.sql
   supabase/migrations/0004_time_logs.sql
   supabase/migrations/0005_projects.sql
   ```
   (Or use the Supabase CLI: `supabase db push` with these files in `supabase/migrations`.)
3. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from Project Settings → API.
   **Never** put the service role key behind `NEXT_PUBLIC_`.
4. In Authentication → URL Configuration, add your app URL (and `/auth/callback`) as a redirect URL.

### Bootstrapping a super admin

Super admins are platform-only — they see company counts and status, never tenant task content.
There's no UI to create the first one (by design: it's a one-time, DB-level action). After someone
signs up normally, promote them with SQL in the Supabase SQL editor:

```sql
update public.profiles set is_super_admin = true where email = 'you@yourcompany.com';
```

## 3. Cloudinary (file attachments)

Create a free account at [cloudinary.com](https://cloudinary.com), then fill in
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`. Uploads are signed
server-side (`/api/uploads/sign`) into a per-tenant folder — the browser never sees your API secret.

## 4. Email (Gmail SMTP)

1. Turn on 2-Step Verification on the Gmail account you want to send from.
2. Create an **App Password**: Google Account → Security → 2-Step Verification → App passwords.
3. Set `GMAIL_USER` to the full Gmail address and `GMAIL_APP_PASSWORD` to the 16-character app
   password (not your normal password).

If these are unset, `sendMail` returns `{ skipped: true }` instead of throwing — every email-sending
action degrades to "recorded, not sent" rather than failing the user's request outright.

## 5. AI provider (optional)

Set `AI_PROVIDER` to `anthropic`, `openai`, or `openai_compatible`, plus `AI_API_KEY` and `AI_MODEL`
(and `AI_BASE_URL` for `openai_compatible` or to override a provider's default endpoint). If left
unset, every AI-assisted feature — task estimates, deadline-extension advice, product ETAs, and
"did this update move the product forward" judgements — falls back to a labelled, rule-based
heuristic. The UI always marks which one produced a given estimate; nothing pretends to be the AI
when it isn't, and nothing the AI says is ever applied without a human approval step somewhere
upstream (see [AI boundaries](#ai-boundaries) below).

## 6. Cron (deadline reminders)

`vercel.json` schedules `GET /api/cron/reminders` every 15 minutes. The route requires
`Authorization: Bearer $CRON_SECRET`. On another host, point any scheduler (cron, GitHub Actions,
a separate worker) at that URL with the same header. The route is idempotent — de-duplicated by a
unique index on `(user_id, type, dedupe_key)` — so calling it twice in the same window does not
double-send.

## 7. Run

```bash
npm run dev       # http://localhost:3000
npm run build && npm run start   # production
```

The first person to sign up creates a company (becoming its admin) via the onboarding flow, or
accepts an email invitation to join an existing one.

## 8. Demo data (optional)

```bash
npm run seed
```

Creates a demo fintech company, five users (admin / PM / tech lead / two employees, all sharing the
password printed at the end), a department, task categories, and one product ("Merchant Payouts
App") with scope items and a pending task. Needs `.env.local` populated first. Safe to re-run — it
skips anything that already exists by name.

## 9. Tests

```bash
npm test          # pure-logic unit tests (tsx --test tests/*.test.ts) — no network, no DB
npm run test:db   # full RLS/tenant-isolation suite against a real local Postgres 16
```

`npm run test:db` needs a local `psql` and a disposable Postgres 16 instance; `supabase/tests/run.sh`
spins one up, loads a minimal `auth.users`/`auth.uid()` mock (so RLS policies that call `auth.uid()`
work outside of real Supabase), applies all five migrations, runs `supabase/tests/rls_tests.sql`,
and prints `ALL DB TESTS PASSED` on success.

## How the domain model works

- **Roles are additive.** A person can be `admin`, `pm`, `tech_lead` and `employee` all at once;
  permissions are the union of whatever roles they hold in a given company. Role checks mirror the
  seeded `role_permissions` table in `src/lib/domain/permissions.ts` (`can()`, `isManager()`,
  `isLeader()`) for fast UI decisions, but RLS — not this file — is the actual security boundary.
- **Tenant isolation** is enforced twice: every child table has a composite foreign key
  `(id, company_id) references parent(id, company_id)`, so a row can never silently point at a
  parent in a different company even if application code has a bug; and RLS policies on every table
  are deny-by-default, built from `SECURITY DEFINER` helpers (`is_member`, `has_any_role`,
  `is_manager`, `is_leader`, `can_view_task`, `can_view_project`, `shares_company_with`, …).
- **Tasks** move through a state machine mirrored in both SQL (`task_transition_allowed`,
  `tasks_guard` trigger) and TypeScript (`src/lib/domain/task-state.ts`), so the UI can pre-check a
  transition but the database is the one that actually enforces it. A task's `original_deadline` is
  frozen the moment it's approved and can never change again; `current_deadline` is the live
  deadline and only moves through an **approved** extension request
  (`request_deadline_extension` → `decide_deadline_request`). Both are always shown together in the
  UI so an extension never quietly erases the fact that something was late.
- **Unplanned/urgent work** (`unplanned_work_entries`) is a completely separate table from `tasks`,
  not a flag on a task — reported by the employee who did it, then **reviewed** by a PM,
  **verified** by a tech lead, and **approved** by an admin, each step a distinct, timestamped,
  attributable action. It is never silently merged into planned-task stats: analytics reports
  planned and unplanned hours separately, and a late *planned* task is never excused by unrelated
  unplanned work unless a blocker explicitly ties the two together.
- **Blockers** record whether they're external (vendor, another team, a dependency outside the
  reporter's control) — `lateTasksWithExternalBlocker` in `src/lib/domain/analytics.ts` exists
  specifically so a delay caused by something outside someone's control is visible as such, rather
  than folded into a generic lateness number.
- **Stand-ups and weekly reports** (`src/lib/domain/summaries.ts`) are generated *from* task
  records, activity logs and time logs — never hand-typed — so a task completed yesterday cannot
  be re-reported as news today, and a report can't claim progress nobody logged.

### Products (company-wide initiatives) {#products}

This is the "what are we building" layer the admin asked for, sitting above individual tasks:

- An admin creates a **product** (`projects` table — named generically in the schema since the
  underlying model also covers an internal initiative, not only a customer-facing app) with a name
  and description, assigns whichever staff are working on it, and optionally sketches rough scope
  items with hour estimates.
- The AI proposes an **initial ETA** right after creation (`planProject` in `src/lib/ai/projects.ts`)
  — either genuinely from the AI provider, or a heuristic estimate (`initialEtaFromScope`) built from
  scope hours ÷ team capacity when no provider is configured or scope items already exist. Either
  way it's advisory and the admin can re-run it (`refreshProjectEta`) or just ignore it; a separate
  **target date** field is always the admin's own, never overwritten by AI output.
- When someone posts an update, they **name the product** they're talking about
  (`postProjectUpdate`). The system also auto-generates an update whenever a task or unplanned entry
  tagged to a product progresses or completes (`linkWorkToProject`, called from `tasks.ts` /
  `unplanned.ts`), so people don't have to manually re-report work already recorded elsewhere.
- Every update is judged by `processProjectUpdate` (`src/lib/server/projects.ts`), which asks the AI
  (or the heuristic fallback) **whether this update actually advances the product's declared scope**
  — per the requirement: *"ai will automatically understand if the update given by the staff is any
  way contributing to the progress of the admin project that was set, if not, nothing happens."*
  - If it doesn't contribute: the update is still saved (nothing is ever discarded) and an
    evaluation row explains why not — but no scope item, no progress number, and no ETA changes.
  - If it does: `applyEvaluation` (`src/lib/domain/projects.ts`) raises the matching scope item(s),
    capped at +50 points per update unless the update records a *completed* task — one vague update
    can never single-handedly mark something done — and progress only ever goes forward from an
    update; only an admin can manually lower a scope item's completion.
  - Either way, the judgement — contributes yes/no, reasoning, exactly which scope items moved and by
    how much — is written to `project_update_evaluations`, an append-only table, so "why did progress
    jump" is always answerable and never just asserted.
  - Product progress itself is a DB trigger (`recompute_project_progress`), a weighted average of
    scope-item completion — not something any client can write directly (enforced by column grants),
    so the number on screen can't drift from what the scope items actually say.
- A **projected ETA** (`projectedEta` in `src/lib/domain/projects.ts`) is recomputed from observed
  velocity whenever progress moves, and shown next to — never instead of — the AI's original
  estimate and the admin's target date, so "when the AI first guessed," "where we're actually
  trending," and "what the admin committed to" are three distinct, clearly-labelled numbers.

### AI boundaries {#ai-boundaries}

The build brief was explicit that the AI must never invent history and must never be the final
decision-maker. Concretely:

- The AI never writes to `task_approvals`, never decides a deadline extension, and never marks a
  task complete — those are always `decide_task_approval` / `decide_deadline_request`, called by a
  human with the right role, enforced by RLS and the `tasks_guard` trigger regardless of what the UI
  sends.
- Every AI output used anywhere (`src/lib/ai/`) is parsed with strict JSON validation
  (`src/lib/ai/parse.ts`); a malformed or out-of-range response is rejected and the request falls
  back to the heuristic rather than silently accepting garbage.
- Every AI-sourced number stored in the database carries a `source` (`'ai'` or `'heuristic'`) and,
  for AI, `provider`/`model` — so nothing is ever presented as "the AI said X" when it was actually
  the fallback, and a company with no AI key configured still gets a labelled, honest estimate
  instead of nothing.
- Nothing the AI judges — a task estimate, a deadline-extension recommendation, a product update's
  contribution — ever rewrites history: `project_update_evaluations`, `task_activity_logs`, and
  `task_approvals` are all append-only (`forbid_mutation` trigger), so a later re-evaluation adds a
  new row rather than editing or deleting the old one.

## Design decisions worth knowing about

- Unplanned work lives in its own table; task/unplanned-work "unified" views in the UI (task list,
  team tasks) merge the two client-side for display, but they are never the same record.
- A PM/admin requesting clarification on a task or an unplanned entry returns it to draft/
  `clarification_requested` status rather than rejecting it outright — a second chance before a
  formal rejection.
- A PM or admin cannot approve their own task unless the company setting `allow_self_approval` is
  explicitly turned on (off by default) — this is a deliberate separation-of-duties default, not an
  oversight.
- The super admin's platform view (`/platform`) is counts and company-status toggles only
  (`platform_stats`, `platform_list_companies`, `platform_set_company_status`); RLS does not grant it
  any path to tenant task/project/unplanned-work content, by design, not just by omission in the UI.
- The kanban board (`TaskBoard`) has no drag-and-drop — it's a read view with per-card status, not a
  status-change surface. Status changes go through the explicit approval/progress/completion actions
  so every change is attributable and goes through the same guard rails everywhere.
- Retention (`settings.retention_days`) is stored and shown in company settings but **not currently
  enforced** by any job — see the implementation report.

---

## Implementation report

Written honestly, per the brief: nothing below is claimed to work unless it was actually run and
observed to pass. The environment this was built in has outbound package installation disabled, so
`node_modules` was never created and the Next.js application itself was never compiled or started.
That one constraint is the reason the "not run" column below is as large as it is — it is not a
reflection of missing effort on any individual piece.

### Fully implemented and tested

Run and passing, in this environment, on every request to re-verify:

- **Database schema, triggers, RPCs, and RLS** — all 5 migrations, applied to a real local
  PostgreSQL 16 instance (not mocked, not SQLite) with a minimal `auth.users`/`auth.uid()` shim.
  `supabase/tests/rls_tests.sql` exercises: tenant isolation (a user in company A can never read or
  write company B's tasks/projects/unplanned work/anything else, including through unusual joins);
  the full task state machine and its illegal-transition rejections; original-deadline immutability
  across every path that could plausibly change it; the deadline-extension approval flow; the
  unplanned-work independent review chain (report → review → verify → admin-approve) including that
  an employee cannot self-approve their own report; immutability of `task_activity_logs`,
  `task_approvals`, `audit_logs`, `task_time_logs`, `project_updates`, and
  `project_update_evaluations`; the "last admin can't be removed/demoted" protection;
  `create_company`/`accept_invitation`; and the project/product RPCs and the progress-recompute
  trigger. Run with `bash supabase/tests/run.sh`; prints `ALL DB TESTS PASSED`.
- **Pure domain and library logic** — 25 passing `node:test` tests
  (`npx tsx --test tests/*.test.ts`) covering: date/working-day arithmetic; the TS mirror of the task
  state machine and permission checks; the contextual analytics (`computeMetrics`,
  `computeWorkload`) including the external-blocker-vs-lateness distinction; daily/weekly summary
  construction from raw records; AI prompt-response JSON parsing and validation (including rejecting
  malformed/out-of-range model output); the heuristic fallbacks for task estimation, deadline-advice,
  and product-update judgement; product progress math (`computeProgress`, `applyEvaluation` and its
  "no contribution → no change" and "+50 cap unless task completed" rules); and ETA math
  (`initialEtaFromScope`, `projectedEta`).

### Written, but not run or compiled (no network access to install dependencies)

Everything else: the entire Next.js application. This includes every page under `src/app/`, every
Server Action in `src/actions/`, every client component, the Supabase client/middleware wiring, the
Cloudinary signed-upload route, the Nodemailer email sending and templates, the cron reminder route,
rate limiting, and the live call paths to an actual AI provider (the parsing/validation around those
calls is tested; the network call itself is not, since no API key was available to call out to one).
This code has been written carefully against the schema and against itself — action signatures were
cross-checked against the pages that call them, and the pure logic those actions depend on is tested
— but **none of it has been started, clicked through, or screenshotted**, and no claim is made here
that it runs correctly. The honest status is "should work, unverified," not "works."

### Credential-dependent (cannot be exercised without secrets that weren't provided)

- Supabase project connection (real `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`)
- Cloudinary signed uploads (`CLOUDINARY_*`)
- Gmail SMTP sending (`GMAIL_USER` / `GMAIL_APP_PASSWORD`) — degrades to "recorded, not sent" when
  absent, which **is** exercised by the logic tests, but actual delivery is not
- A live AI provider call (`AI_PROVIDER`/`AI_API_KEY`) — the heuristic fallback path is tested; the
  real network call is not
- `CRON_SECRET`-gated reminder cron

### Not implemented, or implemented only as a stored setting

- **Retention enforcement** — `settings.retention_days` is stored and editable but nothing purges
  or archives data on a schedule.
- **Kanban drag-and-drop** — intentionally a read view, not implemented as a status-change gesture.
- **Browser/visual QA and end-to-end tests** — none exist. No Playwright/Cypress suite, no visual
  regression check, no accessibility audit beyond semantic HTML and `aria-*` attributes used while
  writing components.
- **Load/performance testing** — not done.

### Outstanding security notes (not fixed, flagged for a real pre-launch review)

- The `app.privileged` transaction-local flag that lets specific `SECURITY DEFINER` RPCs bypass
  parts of the `tasks_guard`/immutability triggers is a deliberate, narrow escape hatch, but it is
  exactly the kind of mechanism that deserves a second pair of eyes before production use — a bug in
  one of those RPCs would have a wider blast radius than a bug in an ordinary RLS policy.
  `supabase/tests/rls_tests.sql` exercises the intended paths; it does not attempt to fuzz for
  unintended ones.
  - The specific rule worth re-checking under real load: stable `SECURITY DEFINER` helper functions
    cannot see a row inserted earlier in the *same* statement, which is why the `tasks`/`projects`
    `SELECT` policies inline a creator/leader check instead of calling the helper for that one case.
    That inline duplication is a second place the same logic has to stay in sync — worth a
    policy-by-policy diff against the helpers before trusting it long-term.
- The service-role (admin) client bypasses RLS entirely by design, and is used in several server
  paths (`notify`, product-update evaluation, rate limiting, platform RPCs' underlying tables). Every
  such usage found in this codebase manually scopes by `company_id`, but that is a convention
  enforced by code review, not by the database — a future change that adds a new admin-client query
  without a `company_id` filter would not be caught by RLS the way an ordinary client query would.
- No dependency-vulnerability scan, no secrets scan, and no penetration test have been run against
  this code — all three should happen before production use, and none of them could be done here
  without network access and a running application.
- Rate limiting is DB-backed and covers the paths that call `rateLimit()` explicitly (auth attempts,
  invitations, AI calls); it has not been verified under concurrent load, and any server path that
  doesn't call it is, correspondingly, not rate-limited.
