# A-level revision supporter

Requirements and implementation reference, version 1.0. Prepared 12 November 2026.

This system extends the existing static website. It helps a student decide what to practise next, using chapter-level confidence, demonstrated results, uncertainty, review history, available time and maintained exam dates. It does not predict examination grades.

## Reading order

1. [Product requirements](requirements.md): numbered requirements, scope, user journeys and acceptance criteria.
2. [Interface and accessibility](interface.md): screens, question states, design integration and recovery behaviour.
3. [Database and API](backend.md): entities, permissions, transactional operations and exact RPC contracts.
4. [Question authoring and imports](questions.md): JSON format, stable topic IDs, notation, images and content review.
5. [Learning model and scheduler](algorithms.md): equations, defaults, examples and limitations.
6. [Manual Supabase setup](setup.md): ordered installation and maintenance using the browser dashboard.
7. [Verification and development](verification.md): automated checks, live acceptance checks, traceability and release phases.

## Delivered components

- The [revision interface](../index.html), buildless HTML/CSS/JavaScript, with vendored browser libraries.
- [Public configuration](../config.js), initially empty. Never add passwords or service-role credentials.
- SQL scripts in `supabase/revision/`, run in numeric order. No CLI, Edge Function deployment or GitHub connection is required.
- A generated [catalogue](../catalogue.json) for content authors: 2 subjects, 14 books, 118 chapters and 558 subtopics. This is textbook metadata; official paper mappings are separate records.
- [Question template](../imports/question-template.json), [JSON Schema](../imports/question-schema.json) and local integration fixtures.

Your administrator supplies the Supabase project, testing account, reviewed question bank, reviewed chapter reminders and exam dates. Missing content is represented explicitly. The application does not generate answers or invent timetable dates.

## Agreed boundaries

The launch subjects are Edexcel A-level Mathematics (9MA0) and Further Mathematics (9FM0). Confidence and proficiency belong to whole textbook chapters. Further Mathematics includes both core books and a valid pair of optional books from the supplied catalogue. Other subjects, automatic timetable ingestion, AI authoring, automatic marking, answer uploads and full-paper practice are future work.

The implementation is delivered as local repository files. You perform live Supabase setup and your normal website publication. No commits, pushes, project registration or hosting changes are part of this work.
