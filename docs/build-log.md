# VetPulse build log

A phase-by-phase record of what was built, the commands that verify it, and the
defects hit and fixed along the way. Written as the work happened, not
reconstructed afterwards.

Working machine: Windows 11, PowerShell, Node 24 (typed as 22), ~6 GB RAM.
Project moved from the OneDrive BuildWithAI workspace to `D:\Projects\vetpulse`
early on (C: drive had < 1 GB free) so nothing inside the original repo was
affected; npm cache redirected to `D:\npm-cache`.

| Phase | Outcome | Commit |
| --- | --- | --- |
| 1–4: backend + validator + planning | Express/Prisma API, Python validator, seed, tests | `1321a59` |
| 5: web client | React SPA, all 8 modules usable | `3736c2d` |
| 6: CI + screenshots | `.github/workflows/ci.yml`, captures | this commit |

---

## Phases 1–4 — backend, database, CSV validator (committed as `1321a59`)

**Files:** `apps/api/**` (Express 4 + Zod + Prisma modular monolith),
`data-service/vetpulse_csv/**` + 18 unittest tests, `examples/csv/*` (3 demo CSVs),
`apps/api/prisma/schema.prisma` + 3 versioned migrations + deterministic seed.

**Verification commands**

```powershell
cd apps/api
node scripts/db.mjs up          # embedded postgres :54329
npx prisma migrate deploy
npx tsx prisma/seed.ts          # 4 users, 24 cases, 37 samples, 16 tasks
npx tsc --noEmit; npx oxlint src prisma/seed.ts
npx vitest run                  # 63/63 passed (TEST_DATABASE_URL=.../vetpulse_test)
node dist/server.js             # /api/health OK; manual smoke of login + dashboard

cd ../data-service
python -m unittest discover -s tests      # 18/18 passed
python -m vetpulse_csv.cli --file ../examples/csv/samples_invalid.csv   # CLI round-trip
```

**Defects encountered / fixed during these phases**

- `spawnSync('npx', …)` needs `shell: true` on Windows (.cmd shims) — bare spawn
  fails silently; fixed in the test setup, kept and explained in a comment.
- robocopy exit codes `< 8` mean success (not 0) when relocating the project.
- No system PostgreSQL anywhere (`Get-Service`, `Get-Command psql` empty) →
  chose npm-managed embedded postgres driven by `apps/api/scripts/db.mjs`.
- Several bad auto-edits from blind regex file replaces mid-script (wrong imports)
  — all hand-fixed; the lesson (never bulk-regex across files) stuck.
- Recharts-free: dashboard metrics are raw SQL / group-by, no invented numbers.
- Went with the shared generic auth failure message after noticing an
  account-enumeration issue in my first draft (different message per case).

---

## Phase 5 — web client (commit `3736c2d`)

**Files:** full `apps/web/**` (Vite + React 19 + TS, custom CSS, react-router,
Recharts), pages for Login, Dashboard, Cases/CaseDetail, Samples/SampleDetail,
Tasks, Data Imports, Audit, Users (admin-only).

**Verification commands**

```powershell
cd apps/web
npx tsc --noEmit         # clean
npx oxlint src           # 0 warnings / 0 errors (24 files)
npx vitest run           # 17/17 passed
npm run build            # app 270 kB + vendor 52 kB + charts 422 kB (gzip · 79/18/114)
# browser walk-through against the API on :4000 (served web/dist)
```

Walk-through actually performed in a real browser: login, dashboard KPIs from live
DB, case transition OPEN→IN_PROGRESS (+ refusal of invalid ones), closed-case
read-only, sample detail + metadata locking, tasks with overdue badges, admin
user management with self-protection, full CSV import both ways
(`samples_valid.csv` → committed 8/8; `samples_invalid.csv` → commit disabled,
row-level error table rendered with codes).

**Defects hit / fixed in this phase**

- `humanize()` produced “IN Progress” (words ≤ 3 chars kept uppercase) — caught
  by my own tests, fixed to sentence case; also fixed test stub `Response` lacking
  `json()`.
- An interrupted write left stub functions in `SampleDetail.tsx` and placed the
  edit-metadata modal after the component close brace — restructured properly.
- Sample transition buttons rendered raw `IN_PROCESS` — humanized.
- `import 'styles.css'` breaks Rollup resolution — `./styles.css`.
- `tsc` resolving the wrong global `tsc` package at repo root — always run from
  the right workspace.
- Stray nested `vetpulse/vetpulse/` tree from an early wrong-path write — deleted
  and removed from the git index (`53a5735`).
- vitest worker pool OOM on this low-RAM machine → single-fork mode committed in
  `vitest.config.ts` with an explanatory comment.
- esbuild/prisma postinstall blocked by the npm install-scripts policy → explicit
  `allowScripts` entries in both `package.json`s (only those exact versions).

---

## Phase 6/7 — CI, Docker, docs (this commit)

**Files:** `.github/workflows/ci.yml` (3 jobs: backend on `postgres:16` service +
Python, web, data-service), `Dockerfile` (multi-stage: web build → api build →
runtime with python3 + bundled `data-service`), `docker-compose.yml` (db + api,
migrations applied on start, also usable as a plain postgres provider on :5433),
`README.md`, `docs/build-log.md`, first screenshots.

**Verification** — `python -c "import yaml; yaml.safe_load(...)"` validates both
workflow and compose YAML. Every CI command was run locally and passes (63 API +
17 web + 18 python tests, lint + typecheck + builds). The GitHub Actions run and
the docker image build could themselves not be executed: no hosted remote yet for
Actions; no Docker/WSL2 on this machine. Both gaps are stated in the README.

**Defects / notes in this phase**

- Screenshots require the browser desktop window to be visible; captures are
  added opportunistically when the window is available (`docs/screenshots/`).
- The 8 h session TTL expires the browser mid-verify; a local-only helper
  (`apps/api/scripts/mint-token.mjs`) mints a session cookie for automated UI
  verification — clearly marked as a dev tool, not app code.

---

## Definition-of-done snapshot

| Requirement | Status |
| --- | --- |
| Frontend ↔ backend integration (not mocked) | ✅ SPA talks to Express via cookie auth; single-origin serve + CORS dev proxy |
| Manual UI testing of every module | ✅ scripted walk-through (see phase 5) |
| Tests: API / web / python | ✅ 63 + 17 + 18 passing |
| Lint + typecheck + prod builds | ✅ both apps |
| Versioned migrations + seed | ✅ 3 migrations, deterministic seed |
| Error contract enforced everywhere | ✅ `{error:{code,message,details?}}` incl. dedicated test file |
| Auth + roles server-side | ✅ JWT httpOnly cookie, ADMIN/STAFF, self-demotion refused |
| CSV import atomicity | ✅ single-transaction commit, COMMIT_FAILED recorded outside the failed tx |
| Docs honest & complete | ✅ README + build log + validator contract |
| Synthetic data only, no Zoetis branding | ✅ everywhere, including UI footer |
| No credentials committed | ✅ `.env` gitignored, placeholder `.env.example`, compose secret explicitly flagged |
