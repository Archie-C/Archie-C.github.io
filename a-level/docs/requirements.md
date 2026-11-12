# Product requirements

Status: implemented v1 baseline. See [verification](verification.md) for evidence and checks that require your live project.

## Purpose, audience and success

The initial audience is one student preparing for Edexcel Mathematics and Further Mathematics, using a privately supplied account. The administrator maintains syllabus metadata, reviewed questions and exam dates through Supabase. Student-data isolation must remain correct with multiple accounts even during this single-student pilot.

The main success criterion is a usable next-question recommendation without the student manually assembling a timetable. Supporting measures are chapter coverage, initial assessment completeness, different questions attempted, practice across different days, and performance on unseen questions. Educational improvement requires longitudinal evaluation; passing software tests alone does not establish it.

## Authentication and settings

| ID | Requirement | Acceptance |
|---|---|---|
| AUTH-01 | Use Supabase email/password authentication with an administrator-created account. | Correct credentials open private revision data; failed credentials display an error without exposing records. Public signup is disabled in Supabase. |
| AUTH-02 | Isolate each user's profile, enrolments, progress, sessions and attempts. | A second authenticated account cannot read or change the first account's records, including by guessing IDs. Anonymous access fails. |
| SET-01 | Configure subjects, Further Maths options, daily time, timezone and exam year. | Values survive reload; invalid combinations fail atomically. Time defaults to 60 minutes and accepts whole minutes from 5 to 480. |
| SET-02 | Changes affect future recommendations without deleting evidence. | Queued work is rebuilt after settings changes; an already active question remains available to complete. |
| SET-03 | Explain missing backend configuration. | An unconfigured installation shows setup instructions instead of a broken login or invented demonstration data. |

## Syllabus and onboarding

| ID | Requirement | Acceptance |
|---|---|---|
| SYL-01 | Import only the board-specific Maths and Further Maths CSVs. | Seeds contain 45 Maths chapters, 73 Further Maths chapters and 558 subtopics, without duplication from the legacy Further Maths CSV. |
| SYL-02 | Group textbook subtopics under chapters and books. | Students rate whole chapters; authors can tag questions to individual subtopics. Textbook volumes are not assumed to be examination papers. |
| SYL-03 | Allow confidence ratings of 1–5 or blank. | Assigning a number marks a chapter covered. A blank chapter cannot appear in a newly activated question. Clearing a rating preserves previous attempts and model evidence. |
| SYL-04 | Distinguish confidence from assessed proficiency. | Confidence is labelled self-reported. An unattempted chapter is shown as not assessed, even though the backend maintains a weak prior. |
| SYL-05 | Provide accessible chapter reminders. | Clicking, tapping or keyboard-activating the chapter disclosure shows subtopics and any reviewed description/example. Missing reviewed material is labelled. |
| SYL-06 | Prompt for a weekly syllabus check. | A check becomes due seven local calendar days after the previous one. Visible time spent on the syllabus review counts towards the current day's target, capped at 30 minutes. The same check cannot be credited twice. |

## Question practice and persistence

| ID | Requirement | Acceptance |
|---|---|---|
| Q-01 | Schedule only verified questions whose linked chapters are all covered and selected. | Mixed questions containing an uncovered chapter are excluded; drafts and withdrawn questions cannot be newly activated. |
| Q-02 | Record ease before exposing the answer. | Ease 1–5 is mandatory for reveal; the answer is absent from earlier RPC responses. Once revealed, ease is locked. |
| Q-03 | Complete using separate correctness 1–5, duration and optional marks. | Correctness cannot be submitted before reveal. Earned marks must be whole numbers between zero and the stored total. The historical attempt records its question version. |
| Q-04 | Support self-marked paper working. | Mathematical questions, diagrams and worked solutions render; no typed mathematical answer or automatic correctness judgment is required. |
| Q-05 | Keep an active timer with pause/resume and optional wake lock. | Time accumulates only while the question is visible and unpaused. Leaving the tab or question pauses it; reloading resumes paused. Unsupported wake lock does not block practice. |
| SAVE-01 | Preserve interrupted work on the same device. | Local drafts retain duration, ease, correctness and marks. Server checkpoints preserve active duration, ease, reveal state and draft correctness/marks. Browser storage failures stop the timer and display an actionable error. |
| SAVE-02 | Retry safely after disconnection or lost responses. | The exact request is persisted before transmission. Replaying completion produces one attempt and one model update. Pending work is visible and blocks duplicate completion and signout. |
| SAVE-03 | Detect competing tabs. | Version conflicts stop automatic writes. The student can review the latest session before rebasing pending work; the local draft remains available. |
| SAVE-04 | Preserve work across authentication expiry. | An expired session cannot write private records. The user can sign in again, after which their own outbox is retried. Another account never loads that outbox. |

## Learning and recommendations

| ID | Requirement | Acceptance |
|---|---|---|
| MOD-01 | Maintain a low-strength confidence prior and fractional Beta evidence. | Confidence means are 0.1–0.9, prior strength is 2, and correctness maps to 0–1. A mixed question contributes total evidence 1 across distinct chapters. |
| MOD-02 | Preserve the evidence needed to revise the model. | Attempts, original priors, ratings, question versions and immutable question-topic links remain available. Later confidence changes do not reset an assessed chapter. |
| MOD-03 | Explain estimate uncertainty and coverage. | Views show provisional proficiency, posterior standard deviation, different questions, practice days and assessed subtopics. Ease and correctness have separate distributions. |
| SCH-01 | Prioritise three different diagnostic questions per covered chapter. | Diagnostic candidates receive priority above ordinary candidates when time, diversity and newness are otherwise comparable. New subtopic coverage is preferred. |
| SCH-02 | Balance weakness, uncertainty, retention and exam proximity. | The documented four-component score and deterministic tie-breaks produce reproducible recommendations for fixed data/time. |
| SCH-03 | Prefer new questions and retain retirement history. | Any correctness of 2–5 retires the stable question ID for that student. A completely incorrect question is reusable from the following local date, never twice in one session. |
| SCH-04 | Adapt the queue to actual time without interrupting a question. | Completion changes remaining capacity and recommendations atomically. An active item is retained. Overlong next questions are explained and the student can finish instead. |
| SCH-05 | Maintain diversity and spaced retention. | Avoid a third consecutive chapter or subject when a fitting alternative exists. Use 1, 3, 7, 14, 30 and 90 day review intervals; no multiple same-day interval promotions. |
| SCH-06 | Allow finishing or voluntary continuation. | No question starts automatically. Reaching the target offers a finish action or another voluntary batch. Missed days affect urgency without creating fixed overdue time blocks. |

## Content, exams and dashboard

| ID | Requirement | Acceptance |
|---|---|---|
| CONTENT-01 | Import versioned reviewed content in JSON. | Unknown tags, invalid metadata and unsafe image URLs fail the entire import. Published versions are immutable; reimporting identical content is safe. |
| CONTENT-02 | Respect source and review metadata. | Every question includes source title/licence; verified content also records a reviewer. Only reviewed questions enter practice. No textbook question text is copied by the catalogue generator. |
| CONTENT-03 | Render safely. | Markdown, LaTeX and images work; raw HTML is displayed as text and unsafe links/scripts cannot execute. |
| EXAM-01 | Use maintained dates and paper mappings. | Each exam has a date, source link and provisional flag. Only relevant selected papers and the chosen year appear. The Python prototype's dates are not seeded. |
| EXAM-02 | Communicate planning limits. | Show coverage and a diagnostic-work estimate; flag when even that work exceeds capacity. Explain missing questions and excluded future retention/improvement workload. Do not label estimates predicted grades. |
| DASH-01 | Summarise today and longer-term learning. | Show target progress, queue/resume, coverage, question counts, practice duration, daily history, stronger/weaker estimates and per-chapter distributions. |
| UX-01 | Match the rest of the website. | Use current Paper tokens, JetBrains Mono/Inter/Source Serif typography, restrained borders, established navigation and KaTeX. No new visual framework is introduced. |
| UX-02 | Remain usable on phones and keyboards. | No horizontal page overflow at 390px; controls have labels, visible focus and sufficient touch targets. Reminders are disclosures, not hover-only content. |

## Pilot evaluation

After sufficient bank coverage, observe whether onboarding is manageable, the chosen time budget produces reasonable queues, and students can recover without losing work. Compare unseen-question performance over multiple days. Review chapter sizes, duration estimates and repeated-question behaviour before interpreting posterior certainty as a learning outcome. Future calibrated models and full-paper practice remain separate work.
