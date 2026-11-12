# Verification, development phases and release checklist

## Local automated checks

The site is buildless. npm dependencies are development-only tooling used to test SQL in PGlite, drive a real Chromium browser and refresh pinned browser assets. They are isolated under `a-level/tests` and excluded from published output.

From that directory:

```powershell
npm ci --ignore-scripts
npm run test:db
npm run test:browser
```

`npm test` runs both suites. The browser suite starts its own loopback HTTP server and closes it afterwards. On Windows it uses installed Chrome or Edge when found. Otherwise install Playwright's Chromium once (`npx playwright install chromium`) or set `REVISION_BROWSER` to an existing browser executable. Screenshots and failure artifacts go in ignored `tests/artifacts/`.

Run `npm run vendor` only when deliberately refreshing the committed browser distributions/shared design copies. Pinned dependencies and lockfile make this reproducible. Runtime libraries and licence notices are committed under `assets/vendor/`; serving the website does not require `node_modules`.

## Coverage

| Requirement IDs | Automated/local evidence | Additional live/manual checks |
|---|---|---|
| AUTH-01, SET-03 | Browser setup state, real client sign-in using emulated Auth HTTP transport. | Actual Supabase email/password login, confirmation and disabled public signup. |
| AUTH-02 | Database authenticated/anonymous roles, cross-user reads, guessed session IDs, denied imports and denied direct progress updates. | Repeat using actual tokens for two temporary accounts; administrator SQL alone is insufficient. |
| SET-01, SET-02 | Required-book expansion, invalid Further Maths route rollback, settings and queue changes. | Select each intended optional route and verify maintained exam mappings. |
| SYL-01, SYL-02 | Exact seeded counts, repeated installation/seeding and deterministic catalogue generator. | Check source CSV metadata against your intended books/specification. |
| SYL-03, SYL-04 | Confidence persistence, blank-chapter exclusion and preservation of assessed evidence. | Evaluate whether chapter granularity is comfortable for the testing student. |
| SYL-05, UX-02 | Keyboard-opened chapter disclosure, mobile overflow checks, labelled controls and responsive screenshots. | Screen reader, zoom, touch and longer/more complex content checks. |
| SYL-06 | Weekly credit and same-week rejection in SQL. | Foreground timer, unfinished weekly check and seven-day/date-boundary usability. |
| Q-01 | Draft/uncovered exclusion, all-linked-chapter eligibility and retirement logic. | Reviewed production bank quality and withdrawn-content workflow. |
| Q-02, Q-03 | Missing ease/reveal rejection, locked ease, independent correctness, marks and version references. | Review mark schemes and representative self-marking behaviour. |
| Q-04, CONTENT-03 | Real Markdown/KaTeX rendering, raw HTML/unsafe-link handling. | Production diagrams, alternate text, longer tables and complicated mathematics. |
| Q-05, SAVE-01 | Real browser reload restores a revealed draft and pauses the timer. | Actual device sleep/tab switching and optional Wake Lock behaviour. |
| SAVE-02 | Offline completion and a committed completion with lost HTTP responses; retry produces one attempt. | Actual intermittent network and reauthentication against Supabase. |
| SAVE-03, SAVE-04 | SQL version conflict and ownership checks; user-scoped outbox. | Competing tabs and real expired/refreshing Auth sessions. |
| MOD-01, MOD-02 | Known Beta updates, one unit of mixed-question evidence, preserved priors/history, idempotent completion. | Longitudinal outcomes before treating estimates as calibrated. |
| MOD-03, DASH-01 | Progress data, separate distributions, practice history and provisional wording. | Review interpretation with the testing student. |
| SCH-01–06 | Actual SQL candidate/queue operations, duration adaptation, diversity/retirement and target behaviour. | Check recommendation usefulness over several days with a varied bank. |
| CONTENT-01, CONTENT-02 | Repeatable immutable imports, invalid tags/assets and review constraints. | Mathematical correctness, source permissions and content review. |
| EXAM-01, EXAM-02 | No invented exam dates; mapped catalogue and empty-state browser view. | Enter official dates and verify provisional status, option variants and workload communication. |
| UX-01 | Exact shared-token copy check, screenshot inspection and Paper accent assertion. | Final published asset availability on the actual GitHub Pages host. |

## Important failure scenarios

Verify behaviour rather than simply matching function implementations:

1. A server commit succeeds, but the browser never receives the response. Replaying the persisted request returns its receipt without incrementing attempt/evidence counts.
2. Two requests use the same idempotency key with different bodies. The second fails instead of silently changing history.
3. A mixed question spans two chapters and several subtopics. It is excluded until both chapters are covered, then contributes total evidence 1 regardless of tag count.
4. Confidence is cleared after successful practice. History and posterior remain, but new questions requiring that chapter disappear.
5. Actual question time exceeds the estimate or the daily target. The active question remains uninterrupted and only subsequent queue entries change.
6. A second browser tab uses an old session version. No partial state commits; the local draft remains available for explicit conflict review.
7. A new question version is published. Existing attempts still point to the old version, and stable-ID retirement remains effective.
8. Browser storage is unavailable or cleared. Do not claim pending work is saved; explain the limit. Clearing storage can permanently remove an unsynchronised draft.

## Delivery phases

The implementation follows these dependency stages; each has a concrete completion gate:

1. **Foundation:** schema, RLS, private solutions, Auth integration, catalogue and public configuration. Gate: counts/security checks pass.
2. **Onboarding:** valid subject/options, confidence, chapter reminders and weekly checks. Gate: covered/uncovered behaviour persists and updates eligibility.
3. **Question workflow:** versioned bank import, timer, reveal/self-marking, drafts and retry-safe completion. Gate: interrupted and lost-response cases preserve one attempt.
4. **Learning and scheduling:** Beta evidence, diagnostic coverage, priorities, retention and queue adaptation. Gate: mathematical examples and queue invariants pass.
5. **Dashboard and integration:** today/progress/exams, mobile/keyboard behaviour, copied site assets and homepage link. Gate: browser flow/screenshots and static checks pass.
6. **Live pilot:** administrator performs browser setup, imports reviewed content and maintains dates. Gate: real Auth/RLS/hosting checks and student usability review complete.

## Release and verification boundaries

Before publishing the frontend, confirm that the database version, functions and public configuration match. Keep all passwords, service-role keys, production imports and student exports outside public source/output. Validate scripts in a test project before a future structural migration. Do not replace the testing student's history with fixtures.

Local integration uses real PostgreSQL execution through PGlite and the real browser libraries. Its Auth and HTTP endpoints are emulated exclusively in the test server. It does not establish that your live project has the correct Auth settings, grants or dates. The [setup runbook](setup.md) lists those checks and the read-only `05-verification.sql` script.

The educational evaluation remains open until the student has used a sufficiently varied bank over time. Record usefulness, timing accuracy, unseen-question results and interpretation problems; refine scheduling based on those observations rather than assuming the heuristic is optimal.
