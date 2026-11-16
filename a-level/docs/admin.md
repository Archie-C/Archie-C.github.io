# Revision administration

The dashboard is at `/admin/`. It extends the existing Supabase Auth session, public configuration, design tokens, Markdown sanitizer, KaTeX renderer and transactional PostgreSQL API. It is buildless and requires no service-role key or Edge Function. Supabase setup and website publication remain manual.

## Install and grant access

1. For a new installation, run the existing scripts `01-schema.sql` through `04-catalogue.sql` first. Existing installations keep their current data.
2. Run the complete [06-admin.sql](../../supabase/revision/06-admin.sql) in the Supabase **SQL Editor** as project owner. This additive upgrade is transactional and rerunnable. Do not reseed the catalogue when upgrading: the original seed can replace admin-edited metadata.
   Then run [07-exam-catalogue.sql](../../supabase/revision/07-exam-catalogue.sql) to enable importing exam dates before their subjects/specifications/topics exist. If 06 is already installed, continue with 07. When reinstalling, always apply 07 after 06.
   For configurable syllabus options, then run [08-options.sql](../../supabase/revision/08-options.sql), followed by [09-chapter-import.sql](../../supabase/revision/09-chapter-import.sql) and [10-question-metadata.sql](../../supabase/revision/10-question-metadata.sql). Migration 10 removes question source/licence metadata from all stored versions and question-import audits. If 09 is already installed, run only 10 before publishing the updated frontend. Apply upgrades in order; rerunning an older API script afterward can replace newer functions.
   Then apply [11-question-coverage.sql](../../supabase/revision/11-question-coverage.sql) to enable the Question coverage dashboard.
3. Create an account through **Authentication → Users**, or choose an existing account. Copy its UUID. In the SQL Editor, promote it:

   ```sql
   select revision_private.set_admin('EXISTING-AUTH-USER-UUID'::uuid, true);
   ```

4. Publish through the normal GitHub Pages workflow, including the root `admin/` directory and `a-level/admin*` assets. Open `/admin/` and sign in. Administrators also get an Administration link in student navigation.
5. Revoke access by running the same SQL with `false`. Every admin RPC checks the current role, including confirmation of an already-open preview.

Role assignment is private, uses invoker privileges and has no browser execution grant. Membership and import history tables have RLS, no browser grants and no browser-accessible private schema. `revision_admin_api` derives identity from `auth.uid()` and checks private membership for every action. Direct content writes and direct solution reads remain revoked. Functions pin an empty search path and qualify relations, following [Supabase function security guidance](https://supabase.com/docs/guides/database/functions). User-editable Auth metadata never determines admin access.

The static HTML shell is public; all protected data and mutations require server permission. Students opening `/admin/` see an access-required screen. Client visibility is never the security boundary.

For local use, run `python a-level/tools/serve.py` from the repository root and open `http://127.0.0.1:8000/admin/`. This server supplies correct module MIME types even when Windows associates JavaScript files with `text/plain`. Stop an older server with Ctrl+C first, then hard-refresh the page.

## Subtopic question coverage

After migration 10, run [11-question-coverage.sql](../../supabase/revision/11-question-coverage.sql) in the Supabase SQL Editor. This rerunnable, read-only API adds no stored records and checks current administrator membership on every request. Include `a-level/admin-coverage.mjs` when publishing the frontend. A missing migration displays a setup message instead of misleading zero counts.

Open **Question coverage** in the admin navigation. The overview shows active subtopics, how many need more questions, and how many meet the working target (five verified questions by default). Change **Question target** to any whole number from 1 to 100, then apply filters. This is a planning threshold for the current admin session, not a syllabus requirement or a student setting.

Filter by subject, specification, chapter or search, then use **All**, **Below target**, **No questions**, or **At target** to narrow the cards. Overview totals describe the filtered syllabus before the coverage-group selection. Cards show the exact verified count, progress to the target, the remaining gap, and latest drafts. Twelve cards appear per page, with the fewest verified questions first. **View questions** opens the bank filtered to that subtopic. **Refresh coverage** rereads live counts and catalogue; returning after imports or reviews also fetches fresh data.

Counts use distinct question IDs within each subtopic. A question tagged to several subtopics contributes once to each. Archived/withdrawn versions and superseded drafts do not inflate counts. A published version still counts while a newer version is a draft; the latest draft appears separately and may overlap the published question ID. Questions linked to any archived subtopic or chapter are excluded from verified coverage, matching practice availability. Archived subtopics and chapters are excluded from this view. Zero-question subtopics remain visible. No questions, solutions or student records are returned by the coverage API.

Run `npm run test:coverage` and `npm run test:browser` from `a-level/tests` for database/version/filter checks and desktop/mobile integration checks.

## CSV workflow and editing

Select a section, then **Import CSV**. Download its header template, add records locally, and upload a `.csv` file or paste CSV. Limits are 500 records / 2 MB per batch. Templates contain no private solutions or invented exam dates.

The workflow is **Input → Parse → Validate → Preview → Confirm → Import**. The CSV state machine supports quoted commas, doubled quotes, CRLF/LF, embedded newlines, UTF-8 BOM and literal LaTeX backslashes. Missing/unknown columns and malformed CSV fail before sending; server validation checks types, references, duplicate IDs and natural keys. Each preview row shows its source line, new/update/unchanged/invalid status, errors and before/after values. Questions, answers and chapter examples have rendered maths previews. Invalid batches cannot be confirmed. Cancel discards the preview without database changes.

The server normalizes and validates the entire batch on both preview and confirmation. The preview token covers canonical changes and prior versions. Confirmation serializes admin imports, rejects stale previews, and applies all records together. Execution errors roll back every content change while saving a failed-import audit. Review a new preview after a stale or failed confirmation.

After a network error, the exact request UUID and payload stay in memory. Keep the tab open and confirm again to replay safely. If the original request committed, its saved result is returned; reusing its UUID with different input is rejected. Importing identical CSV with a new preview skips unchanged records. Input and solutions are never written to browser storage; closing the tab discards pending input.

**View / edit** uses the same preview/confirm workflow for individual records. Stable IDs are read-only. Existing specification/book/chapter/topic/paper parents cannot be changed: structural moves need an explicit owner-run migration that preserves student history. Tables provide search, sorting and pagination. Questions also filter by subject, specification, subtopic, difficulty and status. Exams filter by year, specification and status and default to specification/paper grouping.

### Export topics for question writing

Open **Topics & specifications → Subtopics**, select a subject, specification and/or chapter, then **Apply filters → Export CSV**. The download `revision-topics.csv` contains every matching subtopic across all pages, using a fresh read of the live admin catalogue. Active topics are selected by default; archived topics or topics under archived chapters are excluded unless you change Status. Search also matches chapter, book, subject and specification details.

Filters cascade immediately: **Subject → Specification → Chapter**. Changing a parent clears the selections below it and shows only its descendants. Clearing a parent restores the broader choices. The question bank also narrows **Subject → Specification → Topic**. Search, status, difficulty and sort choices stay intact; use **Apply filters** to update the records and export scope.

Give this file to the question-writing agent and instruct it to use its **id** column for the question CSV's **topic_codes**. Each row includes the exact subtopic ID, number, title, chapter ID, ratings and page metadata, plus chapter/book/specification/subject names and IDs, exam board and archive flags. The export contains no questions, solutions or student data. It provides catalogue context; supply syllabus extracts separately when more detail is needed. Export checks current administrator permission and does not change database records. No new migration is required. The extra context columns make this an agent reference file, rather than the subtopic import template.

### Questions

Use **Review drafts** in the question bank to work through drafts matching the applied search, subject, specification, subtopic and difficulty filters. The queue starts at the first matching draft, regardless of the list's page or status filter. **Review question** on any row opens that question individually.

The review shows the question and worked solution immediately, using the same practice question card, Markdown/KaTeX renderer, diagrams, captions, difficulty and marks as the student view. Relative images and links resolve from `/a-level/` in both views. Read the content, check topic coverage and rights, then click **Verify & next** to publish and open the next draft (**Verify question** for an individual question). There is no checkbox or separate confirmation screen. **Skip** leaves a draft unchanged; **Edit question** opens the existing editor for corrections. Reviewing never starts a student session or records an attempt.

Question review and editing have no source, reference, licence or reviewer fields. Reviewer identity is recorded by the existing admin audit. Verification runs the guarded validation and publication API behind the single action, preserving immutable content versions and import audit. Apply [10-question-metadata.sql](../../supabase/revision/10-question-metadata.sql) to remove the metadata column and purge these fields from existing successful and failed question-import payloads and before/after records. The migration preserves audit UUIDs, responsible admin IDs, timestamps and results, and retains content, solutions, topic links and student history. A question changed during review must be reloaded and reviewed again. If a response is lost, keep the tab open and use **Retry verification** to replay the same request safely. Verified and retired questions can be previewed but cannot be published through the draft review controls.

Required columns: `question_id,topic_codes,question,answer,difficulty,estimated_minutes`.

Optional columns: `marks,status,assets_json`. Removed metadata columns in older CSVs are accepted and discarded before preview or storage.

- IDs follow the existing importer: 3–120 lowercase letters, numbers, underscores or hyphens.
- `topic_codes` contains existing **subtopic IDs**, separated by `|`. Find them under **Topics & specifications → Subtopics**. Multiple chapters are supported.
- Markdown and LaTeX are preserved. Difficulty is an integer 1–5; time is 0.25–120 minutes in whole seconds; marks are blank or a positive integer.
- Blank/missing status means `draft`. Only `verified` questions enter practice. Publishing requires complete content and valid active topic links. Reviewers must check solutions and coverage; validation does not establish mathematical truth.
- The existing `withdrawn` status is also retained for retiring an existing question; like archival, it cannot be combined with content edits.
- `assets_json` uses the existing asset-array format. Omit it to preserve existing assets; use `[]` to clear them in a new version. The existing safe rendering and URL rules apply.
- Content edits allocate the next immutable version for the same ID. Publishing archives the previous verified version. Saving a new draft retains the previous verified version for students until publication or archive. Browsing shows the latest version.
- **Archive question** asks for confirmation, then opens a preview that must also be confirmed. Archive separately from content edits. Past versions, solutions, links, attempts and active student work remain. Queued items are revalidated on activation; start/refresh replans normally. Learned posteriors are never reset.
- Statistics combine all versions for an ID: attempts, mean correctness and mean perceived ease. The two means use the existing independent 1–5 scales.

### Delete the entire question bank

For a one-off hard deletion, run the complete [delete-all-questions.sql](../../supabase/revision/maintenance/delete-all-questions.sql) in Supabase SQL Editor as owner. This is maintenance, not an installation migration; it has not been run against the hosted database. Close revision/admin tabs first and reopen them afterwards. The transaction deletes all question IDs and versions, solutions, question-topic links, queued/active items, question-import history and cached student RPC responses containing old question content. Other import history, accounts, roles, syllabus, exams, settings, selections and confidence ratings remain.

The file defaults to `delete_attempt_history := false` and rolls back everything if any recorded attempts exist. To intentionally remove those attempts too, change that setting to `true`; affected chapter proficiency and review schedules reset to their stored priors, while confidence and priors remain. Session versions advance for cleared queues. A final query reports remaining counts, which should all be zero. The script can be rerun and the deleted question IDs can subsequently be imported again. Tests for both modes run with `npm run test:delete-questions` from `a-level/tests`.

### Exam dates

Required columns: `exam_id,exam_board,specification,paper_code,paper_name,exam_date,start_time,duration_minutes,status`.

Optional columns: `source_url,label,subject_id,subject_name,specification_title`.

Exam dates can be imported without existing subjects, specifications, books or topics. Required board/specification/paper values identify the timetable records. The preview lists missing subjects, specifications and papers; confirmation creates them in the same transaction as the exams. Cancellation and failures leave no new catalogue records behind. Existing catalogue names and topic mappings are preserved. Paper-name capitalisation differences do not invalidate a matching code.

Use a specification ID or qualification code and an existing paper ID or external paper code. New specification IDs are derived from board + qualification code (for example `OCR` + `H777` becomes `ocr-h777`). Without optional names, new subjects/specifications display the supplied specification value; no official subject name is guessed. Supply `subject_name` and `specification_title` for readable labels. Optional `subject_id` groups multiple new specifications under one subject; otherwise each new specification gets a separate subject with the same ID. Existing specifications cannot be moved to another subject through an exam import. Give a shared subject the same name across rows in a batch.

Existing Further Maths option-book papers can be matched by their unique title within the specification. Their official codes (such as `9fm0-3b`) become private aliases of the existing syllabus ID, preserving chapter mappings. Other distinct paper codes remain distinct even if their titles match (for example History variants). Paper-code collisions across specifications get scoped internal IDs and stable aliases. Repeated imports reuse all parents and aliases.

New papers start without chapter mappings. Add these later under **Topics & specifications → Papers & chapter mappings** when their books/topics exist. Importing a timetable does not create topics, enrol students or change student progress. Dates use `YYYY-MM-DD`, year 2020–2100; time is local examination time `HH:MM`; duration is 1–600 minutes. Status is `estimated` or `confirmed`. Source URLs, when supplied, must use HTTPS.

`exam_id` identifies a paper sitting within a year. Updating its date/status preserves its database UUID. Use another external ID for another year; historical years remain. A legacy row without an external ID is adopted when exactly one existing sitting matches the paper/year. If a stable ID already exists, use that ID; for multiple legacy sittings, use the exact UUID shown in the dashboard. Each batch supports one sitting per paper/year.

The existing scheduler and exam view read `revision_exams`, so date changes take effect on the next student bootstrap/start/refresh. No separate timetable or scheduler is introduced. Start time and duration are additional metadata.

### Catalogue and examples

For syllabus content, import parents first: subjects/boards → specifications → chapters → subtopics. Import paper chapter mappings after chapters exist. Each section has its own template. Exam-date imports can create their missing timetable parents automatically.

Chapter CSVs require `id,number,title`; `book_id` is optional. For a new chapter without a book ID, its ID must contain exactly one complete existing specification ID separated by hyphens: for example, `physics-aqa-7408-chapter-1` identifies specification `aqa-7408`. If there is one required book, the chapter uses it; otherwise the importer creates or reuses a required internal chapter container for that specification. The preview shows any container creation. Provide `book_id` explicitly if the ID is ambiguous or a particular book is wanted. Existing chapters retain their current book when `book_id` is omitted. Chapter numbers remain positive whole numbers, unique within the book or container.

The existing book/chapter/subtopic structure provides the topic hierarchy. Subtopic `difficulty_rating` and `length_rating` are initial 1–5 values. Book `required`, `option_family`, `option_level`, `sort_order` metadata is retained for compatibility; configure new optional content through option groups and choices below. Booleans use `true` / `false`; optional blank booleans default to false. Blank optional text clears that field. Supply complete rows when updating, or use **View / edit** to preserve other values.

Chapter `description_md`, `example_md`, `reminder_reviewed` feed the existing **About this chapter** tap/keyboard disclosure in onboarding and the syllabus. Only reviewed reminders appear to students. Edits never write confidence, priors, proficiency or attempts.

Chapters and subtopics can be archived without deletion. Archiving also retires linked verified questions in the same transaction; the preview and audit list those affected questions. Topic rows, historical links and student progress remain. Archived chapters block question imports to their subtopics. Unarchiving does not republish questions automatically. Existing topic rows remain visible to students for continuity. Structural moves and removal require an explicit migration.

Student Settings lists specifications with at least one revision book. Imported subjects become selectable once their books exist. Timetable-only specifications with no books remain outside the revision subject chooser.

### Optional books, chapters and subtopics

After migration 08, use **Topics & specifications → Option groups** to configure how many choices students must/can make, and **Option choices** to define their content. A group belongs to a specification, so different boards/qualifications for a subject can have different rules. A specification may have several independent groups.

Group CSV columns: `id,specification_id,title,min_choices,max_choices,archived` (`archived` is optional). Counts are integers from 0 to 100, with minimum no greater than maximum:

| Minimum | Maximum | Meaning |
|---|---|---|
| 1 | 1 | Exactly one choice |
| 2 | 2 | Exactly two choices |
| 0 | 2 | Up to two choices, including none |
| 1 | 3 | Between one and three choices |

For your Physics example, import a group like this after the specification exists:

```csv
id,specification_id,title,min_choices,max_choices
aqa-7408-options,aqa-7408,Physics optional chapter,1,1
```

Then import choices, replacing the placeholders with existing chapter IDs:

```csv
id,group_id,title,chapter_ids
aqa-7408-option-a,aqa-7408-options,Option A,YOUR_FIRST_CHAPTER_ID
aqa-7408-option-b,aqa-7408-options,Option B,YOUR_SECOND_CHAPTER_ID
```

Choice CSV columns: required `id,group_id,title`; optional `book_ids,chapter_ids,topic_codes,requires_option_id,archived`. At least one content target is required. Use existing IDs separated by `|`. All targets must belong to the group's specification. One choice may bundle several chapters or subtopics; selecting that bundle counts as **one choice**. `topic_codes` means individual subtopic IDs. Book targets include all their chapters/subtopics, and chapter targets include all their subtopics. Content outside every group is core content.

Import content first, then groups, then choices. A prerequisite must already exist in the same group; import it before the dependent choice. Circular prerequisites and moving existing groups/choices to new parents are rejected. Group counts are enforced when students save Settings and start/refresh/activate practice. A new required group may require existing students to revisit Settings before practising.

Students select their specification and its options in Settings. Selected chapters/subtopics determine coverage, relevant mapped exams and eligible questions. A mixed question is excluded if any linked subtopic is unselected. If several groups cover the same content, each applicable group must allow it. Changing choices rebuilds future queues while retaining active work, confidence, learned chapter posteriors and attempts. Proficiency remains chapter-based and includes its retained practice history; it is not reset when subtopic choices change.

Archive preserves option/group rows and keeps their targeted content gated; it does not turn that content into core material. Students must review retired selections before further practice. Use archiving rather than deletion. Preview/confirmation and audit cover counts, mappings and prerequisites like other catalogue edits.

Migration 08 seeds Further Maths with exactly two choices using the current optional books. Each level-2 choice requires its matching level-1 choice. Existing book selections migrate without changing attempts or progress. The legacy `books` settings payload remains supported for existing clients.

## Students and audit

Students lists existing Auth accounts, including accounts without a revision profile. It reads existing profiles, enrolments, progress and attempts. Details show books/specifications, time settings, coverage of selected chapters, estimated proficiency, posterior standard deviation and the latest 30 attempts. Account deletion, password resets and direct editing of learned state are not provided.

Import history records every confirmed batch, including manual edits: request UUID, responsible Auth UUID, UTC timestamp, type, filename if uploaded, inserted/updated/skipped/failed counts, errors, affected stable IDs and canonical before/after values. Question before-values include the prior version. Failed batches retain proposed changes for inspection but apply no content changes. Pre-confirmation previews are read-only and are not logged. Keep database exports private: audits include solutions and student identifiers.

## Verification and release

From `a-level/tests`, run `npm ci`, then `npm test` (`npm.cmd` on Windows if PowerShell blocks npm.ps1). No runtime dependency was added. `npm run test:admin` covers CSV edge cases and the real PostgreSQL migration, guards, repeat imports, immutable edits, exam identity, stale previews, rollback, catalogue, student isolation and audits. Existing tests cover scheduler/model regressions. Browser tests use Chrome/Edge or `REVISION_BROWSER`, real local PostgreSQL functions and emulated Auth/HTTP, including dashboard preview/cancel/confirm/edit, lost responses and mobile layouts.

Before production use, perform live checks with two actual Supabase accounts:

1. Apply migrations 06 through 10 in order, and promote only the intended administrator. An existing 09 installation needs only 10.
2. Verify the student sees access denied at `/admin/`, gets `ADMIN_REQUIRED` from direct admin RPCs, and cannot write roles/content or read private history/solutions.
3. Import reviewed test content and an exam date. Repeat the CSV; verify no duplicates. Edit them and check student bootstrap/start/refresh uses changes.
4. Complete an attempt before editing a question; verify the original version and learned progress persist afterward.
5. Check invalid CSV, cancellation, archival, audit and role revocation through actual Auth/PostgREST. Verify GitHub Pages redirects `/admin` to `/admin/` and serves all vendored assets.

Local transport tests do not verify production Auth settings, grants or migration state. This implementation does not modify live Supabase or publish automatically.
