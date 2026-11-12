# Manual Supabase setup and maintenance

This runbook uses the Supabase browser dashboard. No GitHub integration, Supabase CLI, Edge Function deployment, database password in the website or automated production connection is required.

## 1. Choose the project

Open your Supabase project or create one through its dashboard. You may use the site's existing project: all new public objects use the `revision_` prefix, with private helpers in `revision_private`. The supplied scripts do not touch the existing rocket exercise tables/functions.

Keep credentials in Supabase. Later you will copy only the project URL and publishable key (or legacy anon key) into the public configuration file. Never copy a service-role key, database connection string or student password into source code.

## 2. Run the database scripts

Open the project's **SQL Editor**. Paste and run these complete files in order, one at a time:

| Order | File under `supabase/revision/` | Expected result |
|---|---|---|
| 1 | `01-schema.sql` | Creates namespaced tables, indexes, RLS and read grants. |
| 2 | `02-functions.sql` | Creates transactional API and private helpers. |
| 3 | `03-import.sql` | Creates the administrator-only question importer. |
| 4 | `04-catalogue.sql` | Seeds 2 subjects, 14 books, 118 chapters and 558 subtopics, with separate paper mappings. Does not seed exam dates. |
| 5 | `05-verification.sql` | Runs read-only counts and privilege checks. |

Each installation script is transactional. If one fails, fix the reported error and rerun that file before proceeding. The same initial-version scripts can be rerun without deleting student data. They do not replace proper `ALTER TABLE` migrations for future schema changes.

Verification should report 118 chapters, 558 subtopics and 14 books. All `revision_` tables should have `rls_enabled = true`. The API privilege row should be `false / true / false / false` for anonymous execution, authenticated execution, private-schema usage and direct progress updates respectively. Initially the question-count report will be empty/zero.

## 3. Create the testing account

In **Authentication → Users**, use the dashboard's create/add-user action to create the student's email/password account. Confirm the email through the dashboard if needed for this privately provided testing account. Do not create Auth users by inserting rows into `auth.users` with SQL.

In Authentication provider/settings controls, keep email/password enabled and disable new public user signups for this pilot. There is no signup form in the website, but the dashboard setting is still required to prevent direct signup requests. Provide credentials to the student separately from the repository.

The first authenticated `bootstrap` call creates the student's revision profile. It uses the browser's timezone, defaults to 60 daily minutes, and opens onboarding. There is no requirement to pre-insert a profile manually.

For real Supabase behaviour, consult [user management](https://supabase.com/docs/guides/auth/managing-user-data) and [password authentication](https://supabase.com/docs/guides/auth/passwords).

## 4. Import reviewed questions

Follow [question authoring](questions.md). Copy the template locally, add your questions and verify solutions, topic links, durations, marks and licensing. Import through:

```sql
select revision_private.import_questions(
  $revision_questions$
  {"schema_version":1,"questions":[]}
  $revision_questions$::jsonb
);
```

Replace the JSON with your actual document. Drafts are not schedulable. To publish, use `review_status: "verified"` and a nonempty `source.reviewed_by`. The original example in the template is intentionally a draft. Reimporting identical content is safe; content edits require a higher version number.

Start with enough questions for the chapters you will mark covered, covering several subtopics and difficulty levels. The diagnostic goal is three different questions per chapter; retention and improvement require more. The application works with an empty bank by explaining what is missing, but cannot provide useful practice until questions are added.

Question JSON includes solutions. Keep your working imports outside publicly served directories. `a-level/imports/`, tools, tests and `supabase/` are excluded from Jekyll's site output. A plain local HTTP server does not honour Jekyll exclusions, so bind local preview to loopback and avoid exposing the entire repository to other users.

## 5. Maintain examination dates

List supported paper IDs first:

```sql
select id,title,option_book_id
from public.revision_papers order by id;
```

Enter dates from an official published timetable, preserving source and status. The following is a template, not an executable seed or a verified date:

```sql
-- Replace every placeholder before running.
insert into public.revision_exams(paper_id,exam_date,provisional,source_url,label)
values (
  '9ma0-01',
  'YYYY-MM-DD'::date,
  false,
  'https://OFFICIAL-TIMETABLE-URL',
  'Summer examination'
)
on conflict(paper_id,exam_date) do update
set provisional=excluded.provisional,source_url=excluded.source_url,label=excluded.label;
```

Set `provisional=true` for an estimate and describe its basis in the label/source. Never relabel an estimate confirmed without verifying it. When a date changes, update the existing row by ID rather than inserting a duplicate sitting for the same year. If there are genuinely multiple sittings, the application shows each; maintain the selected exam year accordingly.

Further Maths option IDs identify content options rather than assuming every textbook has a single universal paper-slot code. Match actual entries/timetable variants when maintaining dates. Both Pure Maths papers can assess the pure syllabus, and both Core Pure papers can assess core content; seeds map those shared chapters to both papers. Check paper mappings against the [official Pearson specification](https://qualifications.pearson.com/content/dam/pdf/A%20Level/Mathematics/2017/specification-and-sample-assesment/a-level-l3-further-mathematics-specification.pdf) when qualifications change.

No date from `a-level/testing.py` is installed as a confirmed timetable.

## 6. Configure the frontend

In project settings, find the project URL and public publishable key (or legacy anon key). Edit `a-level/config.js`:

```js
export default {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabasePublishableKey: 'YOUR-PUBLIC-PUBLISHABLE-OR-ANON-KEY'
};
```

Serve the repository over HTTP and open `/a-level/`. For a local loopback preview from the repository root:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/a-level/`. Do not open `index.html` through `file://`; browser modules need HTTP. The production frontend remains a static page suitable for the existing GitHub Pages deployment. No npm installation/build is needed to serve it: browser libraries, KaTeX fonts and the copied design tokens are already supplied.

For a student in the UK, select **United Kingdom — London (GMT / BST)** in Settings. This saves `Europe/London` and follows seasonal clock changes automatically; no timezone configuration change or SQL query is needed.

Use the normal site publication workflow when ready. This implementation does not commit, push, publish or modify live Supabase automatically.

## 7. Perform live acceptance checks

1. Sign in with the testing account; save subjects/options, target, timezone and exam year.
2. Mark a chapter covered. Confirm blank chapters remain out of the queue and reviewed reminders display correctly.
3. Start practice. Confirm the solution is absent until ease is supplied and reveal succeeds; then self-mark and complete.
4. Reload midway through another question. Verify the draft returns, the timer is paused and the revealed state is retained.
5. Disconnect during a completed-question submission and reconnect. Confirm exactly one attempt exists and one model update occurred.
6. Test a second temporary account through actual Auth tokens; verify isolation and the inability to invoke the importer or write progress directly. Delete the temporary account after verification if no longer needed.
7. Confirm question images, KaTeX, copied CSS and navigation on the deployed host. Jekyll exclusions must not remove `a-level/assets/`.

The local suite tests the PostgreSQL functions and the browser with an emulated Auth/HTTP transport. These live steps verify the actual project's Auth, API grants and hosting configuration.

## Maintenance and recovery

- **Catalogue edits:** modify only the appropriate board-specific CSV, run `python a-level/tools/generate_catalogue.py`, inspect changes, then paste the regenerated seed into the SQL Editor. IDs derive from book names and printed numbers; renaming/reordering those needs a deliberate ID migration to preserve links.
- **Shared styling:** after changing design tokens, run `npm run vendor` in `a-level/tests` and review the copied assets. Do not hand-edit the copied token file.
- **Question corrections:** publish a new version; archive/withdraw, rather than deleting, prior versions. Refresh queued recommendations. Active work is retained.
- **Reminder updates:** use reviewed chapter Markdown and the `reminder_reviewed` flag described in the authoring guide.
- **Backups:** export the student tables and preserve the catalogue/question sources before structural changes. Use the project's available backup facilities as appropriate. Do not place exports in the public repository.
- **Client/server upgrades:** preserve existing API compatibility until the matching frontend is available. Apply explicit schema migrations; initial installation scripts do not perform arbitrary upgrades.
- **Lost response:** reconnect and retry the exact pending request. The receipt returns its committed result. Do not clear browser storage as the first recovery step.
- **Version conflict:** pause competing tabs and use “Review latest saved session.” Preserve local drafts if the active question changed incompatibly; investigate before manually clearing an outbox.
- **Receipt growth:** checkpoints produce receipts. Monitor `revision_private.receipts` during the pilot. Keep receipts while any client may still retry them; any retention policy must exceed the supported offline period and preserve attempt history. No automatic pruning is enabled.

## Troubleshooting

| Symptom | Check |
|---|---|
| Setup screen remains | Public URL/key are empty or the browser has an old cached configuration. |
| Missing API/function error | Scripts 01–04 were run in order against the same project as the public configuration. |
| Sign-in fails | Account exists, email confirmation/provider settings are correct, and credentials match. |
| Empty question queue | Chapters covered/selected, questions verified, all mixed-question tags covered, and bank not retired/exhausted. |
| Further Maths options rejected | Two different level-1 options, or one matching level-1/level-2 pair, must be selected. |
| No exams | Dates exist for the chosen exam year and relevant paper/option IDs. |
| Pending saves | Reconnect, keep one tab open and retry. For confirmed conflicts review the latest state; do not delete drafts. |
| Missing maths/diagrams/style | Static vendor/assets paths are published, images have valid URLs, and shared-token copies are current. |
| RLS appears ineffective in SQL Editor | Administrator queries bypass RLS; test with authenticated client tokens instead. |

See [verification](verification.md) for exact local commands and test coverage.
