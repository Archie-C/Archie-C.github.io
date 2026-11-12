# Interface and accessibility

## Integration and visual language

The revision area uses the existing site rather than a new application framework. Its desktop rail, `a.c` mark, page width, warm Paper background, restrained rules and typography follow the personal-site and course references. Page and control headings use JetBrains Mono; ordinary controls use Inter; mathematical question prose uses Source Serif 4 and KaTeX.

`assets/colors_and_type.css` is a byte-for-byte published copy of the shared token file. This avoids the existing Jekyll exclusion of `design_system/`. Run `npm run vendor` in `a-level/tests` after changing shared design tokens; the browser test detects drift. The copied favicon and pinned browser libraries are also self-contained site assets. Fonts follow the existing Google Fonts import and retain system fallbacks.

Use the current CSS token values as authoritative. Older prose in the design skill names an earlier purple; the live Paper accent is `#6B2C5C`. Application styles consume semantic tokens instead of duplicating palette values. Raw percentages are accompanied by text and evidence; colour never communicates correctness by itself.

## Screens

| View | Purpose and principal actions |
|---|---|
| Setup | Explain missing project configuration and link to the browser setup runbook. No sample student data appears. |
| Sign in | Email/password with autocomplete labels. Accounts are privately provisioned; public signup is absent. |
| First-run settings | Select subjects, valid Further Maths options, daily minutes, exam year and timezone. Saving leads to the syllabus. |
| Today | Time spent against target, chapters covered, questions completed, next/resume action, queue estimates and nearest exam. Prompt for the weekly check when due. |
| Your syllabus | Search by chapter/book, filter by selected book or uncovered status, set chapter confidence, and expand reviewed reminders/subtopic lists. |
| Question practice | Start the next question explicitly, pause/resume, record ease, reveal the solution and self-mark correctness/optional marks. |
| Learning progress | Totals, stronger/weaker estimates, daily practice history and per-chapter evidence/distributions. Unattempted priors remain labelled not assessed. |
| Exam preparation | Relevant maintained dates, provisional labels, chapter coverage, approximate diagnostic workload and capacity limits. |
| Settings | Change subjects/options, target, exam year and timezone without discarding history. |

Hash navigation supports direct links and browser history without requiring server-side routes. The current view receives `aria-current`; the main region receives focus after navigation. A skip link bypasses the rail. There is no public student directory.

Timezone settings use a native dropdown with readable location labels. The UK appears as “United Kingdom — London (GMT / BST)” and saves `Europe/London`, including automatic seasonal clock changes. Suggested choices include the UK, the device timezone and UTC; other browser-supported zones remain available. The saved timezone is preserved even if it is absent from the browser's timezone list.

## Question states

1. **Queued:** eligible question and estimate are visible in the plan; no solution is returned.
2. **Active, unrevealed:** the student works on paper. A paused local draft can be resumed. Ease can be selected; solution reveal requires a connection and a saved ease rating.
3. **Active, revealed:** ease is locked. The worked solution is available and correctness/marks can be entered. The student can pause and reload without repeating reveal.
4. **Completion pending:** freeze the submitted ratings, preserve the exact completion request and offer retry. Do not create a second completion request for the same item.
5. **Completed:** the server records the attempt and updates the model/queue together. Show the next-question or finish choice; never start it automatically.

If the daily target is reached, keep the current question available. Additional practice is voluntary. A continued batch plans up to approximately 15 more minutes while keeping the original target visible. If the shortest available question exceeds the remaining budget, explain its estimated duration before the student starts it.

## Timing and weekly checks

The active timer uses monotonic elapsed time and only runs in the visible practice view. Explicit pause, leaving the practice view, hiding the document and reloading all pause it. Wake lock is best-effort and never a prerequisite. Server checkpoints run on rating changes and normally every 15 seconds while timing; the local draft is saved each timer tick and on rating changes. A sudden process termination can lose approximately one local timer tick; after a reload, the timer remains paused until explicitly resumed.

Weekly checks count foreground time in the syllabus view, with a 30-minute cap. The typical intended duration is 2–5 minutes. Confidence edits save immediately; finishing the check credits its duration once and resets the seven-day reminder. A device-local unfinished check can be resumed.

## Recovery and empty states

- Missing confidence: explain that only learned chapters enter the queue and link to the syllabus.
- Missing questions: name covered chapters without verified bank content. Do not invent questions or silently repeat retired ones.
- Exhausted eligible bank: explain retirement, same-day reuse restrictions and mixed-question coverage requirements.
- Missing exam dates or reminders: state what has not been maintained; never present speculative data as confirmed.
- Lost connectivity: retain the current draft and outbox. An already revealed solution remains usable; unrevealed answers require the server.
- Session conflict: pause automatic writes, preserve the local draft and offer review of the latest saved state. Existing completed items are not resubmitted during recovery.
- Storage failure: stop active timing and explain that browser storage must be available. Keep the page open until work is safely saved.
- Expired authentication: preserve user-scoped local work and require sign-in before database writes.

Pending saves prevent explicit signout. Another user's sign-in uses a separate outbox/draft namespace. Browser storage is not an encrypted vault: students should sign out on shared devices and avoid clearing site data while work is pending.

## Accessibility checks

Use native buttons, labelled selects and radio groups with legends. Radio choices communicate both score and meaning. Chapter information uses keyboard-operable `details`/`summary`, giving desktop, touch and keyboard users the same access. Persistent status uses a polite live region; focus outlines remain visible. Histograms include exact numeric distributions, and daily graphs include a text disclosure with values. Mathematical rendering exposes KaTeX's accessible MathML. Images require alternative text; optional captions explain diagrams.

Validate phone and desktop widths, browser zoom and keyboard-only operation. Question formulas/tables may scroll within their content region; the page itself must not overflow horizontally.
