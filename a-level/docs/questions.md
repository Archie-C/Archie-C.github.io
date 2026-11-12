# Question authoring and imports

## Authoring format

Use [question-template.json](../imports/question-template.json) as a starting point and [question-schema.json](../imports/question-schema.json) for editor validation. Production imports are performed by the administrator in the SQL Editor, not through the student website. Imports are excluded from GitHub Pages output because they contain answers; the templates remain available in the source checkout.

The document has integer `schema_version: 1` and a `questions` array. Each question needs:

| Field | Meaning |
|---|---|
| `id` | Stable lowercase logical ID, 3–120 characters, letters/numbers/underscores/hyphens. Reuse it when issuing a new version of the same question. |
| `version` | Positive integer, starting at 1 and increasing for changed content. |
| `prompt_md` | Question text in Markdown, with inline/display LaTeX as needed. |
| `solution_md` | Mark scheme/worked solution in Markdown. Stored privately and returned only after ease is recorded and reveal succeeds. |
| `subtopic_ids` | Nonempty array of stable IDs from the generated catalogue. Multiple chapters/subjects are supported. |
| `difficulty` | Question difficulty 1–5, authored independently from the textbook's difficulty rating. |
| `estimated_seconds` | Whole estimated working seconds, 15–7200. Include attempting and self-marking time. |
| `total_marks` | Optional positive integer or null. Earned marks remain optional during practice. |
| `assets` | Optional array of question diagrams: `{url, alt, caption?}`. Use HTTPS or relative URLs. These assets are visible before reveal. |
| `source` | Object requiring nonempty `title` and `licence`; optional `url` and `reviewed_by`. Use an appropriate licence/permission description for your actual material. |
| `review_status` | `draft` or `verified`. Verified content requires a nonempty `source.reviewed_by`. |

The supplied example is original content and remains a draft. The integration test bank is artificial test material and must not be used as a substantive revision bank.

## Mathematics, Markdown and diagrams

Write inline mathematics as `$x^2$` and display mathematics as `$$...$$`. JSON requires backslashes to be escaped: `"$\\frac{1}{2}$"` decodes to the LaTeX `\frac{1}{2}`. Use `\n\n` for paragraph breaks inside a JSON string. Ordinary Markdown supports emphasis, lists, tables, code and links. Raw HTML is rendered as text rather than accepted as application markup.

KaTeX runs with `trust: false`. Scripts, event-handler attributes, unsafe links, data URLs and arbitrary HTML are not supported. Do not rely on raw SVG/HTML snippets in Markdown. Use an image file for diagrams and provide meaningful alternative text. Restrict source URLs to your own static assets or authorised HTTPS resources.

Put question diagrams in `assets` for automatic figure/caption rendering, or reference a diagram in the prompt's Markdown, but avoid showing it twice. Embed solution-only diagrams in `solution_md`, not in the public `assets` array. Public image URLs are not a confidentiality boundary; use reviewed content rather than relying on image secrecy to protect answers. The solution text itself stays behind the reveal operation.

Static question images can live under `a-level/assets/questions/`. Relative paths are resolved from the revision page, such as `assets/questions/parabola-001.svg`. Supabase Storage is optional; if used, choose access rules appropriate to the content and ensure durable URLs resolve for signed-in students. Expiring signed URLs should not be embedded permanently in imported Markdown.

## Topic identifiers

The generated `a-level/catalogue.json` supplies exact IDs. For example:

```text
Book:     maths-pure-mathematics-year-1
Chapter:  maths-pure-mathematics-year-1-ch01
Subtopic: maths-pure-mathematics-year-1-s1-1
```

You can also find IDs in Supabase:

```sql
select b.title as book, c.number as chapter_number, c.title as chapter,
       t.id, t.number, t.title
from public.revision_subtopics t
join public.revision_chapters c on c.id=t.chapter_id
join public.revision_books b on b.id=c.book_id
order by b.sort_order,c.number,t.page_start;
```

Tags must describe the skills actually assessed. A mixed question is schedulable only after every linked chapter is selected and covered. At least three different reviewed questions per covered chapter are needed for the initial assessment target; substantially more are needed for useful improvement and retention practice. Distribute questions across subtopics and difficulty levels rather than duplicating prompts under new IDs.

## Import procedure

1. Prepare and validate the JSON. Check every prompt, answer, mark allocation, image, tag, licence and duration.
2. Keep `review_status: "draft"` until review is complete. Set `reviewed_by` and change the status to `verified` when ready.
3. Paste the entire JSON document into a SQL dollar-quoted string:

```sql
select revision_private.import_questions(
  $revision_questions$
  {"schema_version":1,"questions":[]}
  $revision_questions$::jsonb
);
```

Replace the empty JSON with your document. If your text contains the dollar-quote delimiter itself, choose another delimiter. The function returns the number of newly inserted versions. Zero is normal for an identical reimport or draft promotion. Any validation failure rolls back the entire document.

Imports validate required fields, bounds through table constraints, known subtopic IDs, review status/reviewer and asset URLs. The JSON Schema additionally catches editorial mistakes such as extra properties and duplicate tags; the importer normalises repeated tags. Use both schema validation and SQL validation rather than assuming either verifies mathematical correctness.

## Versioning and publication

An identical reimport is safe. To change a prompt, solution, marks, difficulty, estimate, assets, source or tags, increment `version` while keeping `id`. Publishing a new verified version archives the previous verified version. Existing sessions/attempts retain their exact version and original solution. Retirement follows the stable ID, so a corrected version does not silently become a new question for students who have already retired it.

An unchanged draft can be promoted by setting `review_status: "verified"` and adding its reviewer; other edits require a new version. Reimporting an old archived version does not reactivate it. Withdraw content administratively when it should no longer start new attempts:

```sql
update public.revision_questions
set status='withdrawn'
where id='your-question-id' and version=1;
```

Refresh the student's queue afterwards. Activation revalidates publication/coverage. An already active question remains resumable so ongoing work is not destroyed. Do not delete historical versions or their topic links.

## Reviewed chapter reminders

Administrators can add descriptions and examples independently of question imports:

```sql
update public.revision_chapters
set description_md='Short reviewed description.',
    example_md='A reviewed example using $x^2$.',
    reminder_reviewed=true
where id='maths-pure-mathematics-year-1-ch01';
```

These reminders may be drafted elsewhere but must be checked before setting `reminder_reviewed`. Missing or unreviewed reminders are explicitly labelled in the UI.
