# Database and API contract

## Architecture and trust boundaries

The browser uses the pinned Supabase JavaScript client for Auth and one PostgreSQL RPC: `public.revision_api(p_action text, p_payload jsonb) → jsonb`. Auth automatically attaches the student's access token. There is no custom server and no Edge Function in v1. Every supplied SQL script can be pasted into Supabase's SQL Editor.

The public browser configuration contains only the project URL and publishable key (or the project's legacy anon key). These are not administrative credentials. The API derives identity exclusively from `auth.uid()`; no action accepts a trusted `user_id` from the caller.

All exposed tables have RLS. Catalogue rows are authenticated read-only. Student rows allow only their owner to select; direct browser inserts, updates and deletes are revoked. Derived state is changed by the transactional API. Solutions and replay receipts are in the unexposed `revision_private` schema, whose usage and function execution are revoked from browser roles.

The public API uses `security definer` deliberately because students cannot directly mutate the underlying state. It pins an empty search path, fully qualifies relations, checks identity and checks session/item ownership. It grants execution only to `authenticated`. Private helpers have no browser execution grants. See [Supabase function security](https://supabase.com/docs/guides/database/functions) and [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Entities

Every public table below has the `revision_` prefix.

| Entity | Key and responsibilities |
|---|---|
| `subjects` | Stable text ID, subject name and exam board. |
| `specifications` | Stable ID, subject reference, qualification code, title and official source URL. |
| `books` | Specification reference, title, required/core status, optional family/level and display order. |
| `chapters` | Stable ID, book, chapter number/title and optional reviewed Markdown reminder/example. Unique within its book. |
| `subtopics` | Stable ID, chapter, printed subsection number, title, page metadata, length/difficulty ratings and strand. These ratings do not become question estimates. |
| `papers` | Specification and optional-book reference. Paper identity is separate from textbook volume. |
| `paper_chapters` | Many-to-many mapping of examinable chapters to papers. Shared chapters remain a single progress record. |
| `exams` | UUID, paper, date, source URL, provisional flag and optional label. One paper/date pair is unique. |
| `profiles` | Auth user UUID, daily minutes, IANA timezone, exam year, onboarding state and last syllabus-check timestamp. |
| `enrolments` | Composite user/book key. Required books are added automatically for selected specifications. |
| `progress` | Composite user/chapter key; current self-confidence, original prior alpha/beta, current alpha/beta, attempt count, review interval index, due date and last attempt. |
| `questions` | Composite stable ID/version; immutable prompt, difficulty, estimate, marks, assets, source/review metadata and publication status. Only one version per ID is verified at a time. |
| `question_subtopics` | Immutable question-version/subtopic links. Distinct linked chapters determine fractional evidence allocation. |
| `sessions` | UUID and owner; unique user/local-date pair; original target, concurrency version, open/finished status and credited syllabus-check seconds. |
| `queue` | UUID, session, position, exact question version, estimate, reason, queued/active/completed state, ease, reveal timestamp, active seconds, paused status and draft correctness/marks. One active item per session. |
| `attempts` | UUID and owner; unique queue item, exact question version, independent ease/correctness, active seconds, optional marks, UTC completion time, local completion date, idempotency UUID and model version. |
| `revision_private.solutions` | One Markdown solution per question version. Never readable directly by a student. |
| `revision_private.receipts` | User/request UUID, action, exact payload and committed response. Makes retries safe after a lost response. |

Auth-user deletion cascades through owned profiles and attempts. Catalogue deletion is restricted by historical references. Do not delete question versions or topic links used by attempts; archive/withdraw content instead. Rebuilding the catalogue upserts metadata and does not remove history or administrator-authored reminders.

## Common request and response rules

Call from JavaScript:

```js
const { data, error } = await supabase.rpc('revision_api', {
  p_action: 'start',
  p_payload: { request_id: crypto.randomUUID() }
});
```

Every action except `bootstrap` requires a UUID `request_id`. Repeating the same UUID with the same action and payload returns the committed response. Reusing it with different content raises `IDEMPOTENCY_CONFLICT`. A failed transaction leaves no receipt or partial state.

Session mutations require `session_id` and integer `expected_version` in addition to `request_id`. The supplied version must match the saved session. Successful mutations increment it. Use the version returned by the previous response, not a local guess. The API serialises mutations per user with a transaction-scoped advisory lock and locks the target session during session operations.

`bootstrap`, `settings`, `confidence`, `syllabus_check` and `complete` return a full snapshot. Other actions return `{session: ...}`; merge this into the current snapshot. A session contains `items` in position order, including IDs, question-version references, estimates, chapter IDs, prompt, marks, assets, saved ease/duration/reveal state and `solution_md`. Unrevealed items always have `solution_md: null`.

Full snapshots contain `profile`, local `today`, `syllabus_check_due`, `today_check_seconds`, catalogue arrays, selected book IDs, chapter `progress`, paper mappings, exam dates for the chosen year, latest/resumable `session`, up to 90 daily `history` entries, all-time attempt `totals` and verified-bank counts by chapter. Per-chapter progress adds proficiency, variance, distinct-question/practice-day/assessed-subtopic counts and separate five-bin correctness/ease arrays. The frontend filters exams to relevant selected papers.

## Actions

| Action | Additional payload | Behaviour |
|---|---|---|
| `bootstrap` | Optional `timezone`, default `UTC` for a newly created profile; optional owned `session_id`. | Creates a missing profile and returns the full snapshot. Does not replace an existing timezone. Explicit session IDs support conflict recovery and are ownership-checked. |
| `settings` | Optional `books: string[]`, `daily_minutes: integer`, `timezone: string`, `exam_year: integer`. | Validates selections and options, adds required books, preserves history, updates active-session targets and rebuilds queued items. Exam year range: 2020–2100. |
| `confidence` | `ratings: [{chapter_id, confidence: 1..5 or null}]`. | Validates ownership through selected books. Updates unassessed priors; assessed posteriors are retained. Rebuilds queues and increments affected session versions. |
| `syllabus_check` | `active_seconds: integer`, 0–1800. | Records one due weekly check and credits today's session. Rejects a second check within seven local dates. |
| `start` | Optional `continue: boolean`. | Resumes an active question, including one from an earlier date. Otherwise opens/reopens today's session, finishes older inactive sessions and plans a queue. `continue` allows a 15-minute batch after the original target. |
| `refresh` | Session fields; optional `continue: boolean`. | Rebuilds queued items, preserving active and completed items. |
| `activate` | Session fields; `item_id`. | Revalidates verified status and chapter coverage, then activates one queued item. Rejects if another question is active. |
| `checkpoint` | Session fields; `item_id`, integer `active_seconds`, optional `ease`, `paused`, `draft_correctness`, `draft_marks`. | Saves active duration and draft ratings. Correctness/marks require reveal. Ease cannot change after reveal. Draft fields can be null to clear them. |
| `reveal` | Same as checkpoint, with ease required. | Saves ease/duration and records reveal timestamp. The response can now contain the solution. |
| `complete` | Session fields; `item_id`, integer `active_seconds`, `correctness: 1..5`, optional `ease`, optional `earned_marks`. | Requires prior reveal. Atomically inserts the attempt, updates each linked chapter once, completes the item and rebuilds the queue. |
| `finish` | Session fields. | Finishes the session and removes queued items. Rejects while a question is active; pause/resume that question instead. |

Duration must be an integer between the previously saved duration and 86,400 seconds. Optional earned marks must be an integer from zero through the question's total. If a question has no total marks, earned marks must be omitted/null. Correctness and ease always remain independent even when earned marks are supplied.

## Errors and recovery

Errors are Supabase/PostgREST errors with `message` and PostgreSQL `code`. Useful named messages include:

- `AUTH_REQUIRED` (`28000`): authenticate before accessing the API.
- `SESSION_NOT_FOUND` / `ITEM_NOT_FOUND` (`42501`): no accessible owned record; do not reveal whether another user's record exists.
- `SESSION_CONFLICT` (`40001`): pause and retrieve a fresh snapshot; do not blindly overwrite another tab's changes.
- `EASE_REQUIRED`, `EASE_LOCKED`, `REVEAL_REQUIRED`, `INVALID_CORRECTNESS`, `INVALID_DURATION`, `INVALID_FURTHER_OPTIONS`, `CHAPTER_NOT_SELECTED`, `QUESTION_NO_LONGER_ELIGIBLE`, `CHECK_NOT_DUE`, `IDEMPOTENCY_CONFLICT` (`22023`): invalid action/state; correct the input or review the latest saved state.
- Native type/check-constraint errors: malformed UUID/integer, invalid marks or other schema validation. No partial update commits.

Keep the exact transmitted payload until acknowledged. For connection failures, replay it unchanged, including its original version and request ID: the receipt is checked before the version. For a confirmed version conflict, explicitly review latest state before rebasing. Do not replace an uncertain in-flight request with a new UUID; that defeats receipt-based recovery.

The local browser outbox covers question/session workflow operations. Settings and confidence edits require a connection and can be reapplied safely after an ambiguous result; they do not add learning evidence. No server result is trusted as a grade or automatic mark.

## Operations and compatibility

Scripts 01–04 form the initial installation and can be rerun against that installation. `CREATE TABLE IF NOT EXISTS` is not a general schema-upgrade mechanism. Future structural changes need an explicit numbered `ALTER TABLE` migration and corresponding frontend/API compatibility notes. Preserve historical content, priors and attempts during upgrades.

RLS checks must run under authenticated/anonymous roles or through actual client tokens. Queries in Supabase's administrator SQL Editor bypass RLS and cannot alone prove student isolation. The local integration suite emulates Auth identity and exercises the real PostgreSQL policies and functions; live Supabase Auth/PostgREST must still be checked after manual setup.
