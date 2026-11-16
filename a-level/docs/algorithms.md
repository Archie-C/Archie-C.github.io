# Learning model and scheduling

## Model meaning and limits

The chapter model is an engineering approximation for prioritising practice. It treats self-marked questions as fractional evidence about correctness. It is not a calibrated probability of passing an exam. Difficulty, question dependence, marking errors and forgetting are not incorporated into the Beta likelihood. Difficulty helps choose questions, while separate coverage and practice-day metrics qualify the amount of evidence.

Confidence, ease and correctness are different observations:

- **Confidence:** the student's current self-report about a chapter, 1–5 or blank.
- **Ease:** how attempting a particular question felt before seeing its answer, 1–5.
- **Correctness:** the student's self-mark after seeing the answer, 1–5.

Ease and correctness have separate stored histograms. Earned marks are optional historical metadata; they do not replace correctness in v1's model.

## Initial prior and evidence

For confidence `c`, set `m = (c − 0.5) / 5`, `prior_alpha = 2m`, and `prior_beta = 2(1 − m)`. Confidence 1 through 5 gives means 0.1, 0.3, 0.5, 0.7 and 0.9, all with prior strength 2.

The current posterior starts at that prior. Before any attempts, editing confidence replaces it. Once evidence exists, preserve the original prior and posterior; later confidence changes remain a separate self-report. Clearing confidence excludes the chapter from new scheduling without deleting evidence.

For correctness `r`, use `s = (r − 1) / 4`. For a question linked to `k` distinct chapters, each chapter receives weight `w = 1/k`:

```text
alpha := alpha + w × s
beta  := beta  + w × (1 − s)
mean   = alpha / (alpha + beta)
variance = alpha × beta / ((alpha + beta)² × (alpha + beta + 1))
```

Duplicate subtopic tags in the same chapter never multiply evidence. A question with three tags in one chapter and one tag in another still divides evidence equally between the two chapters. Each completed attempt adds total model strength 1 across all chapters combined.

Example: confidence 3 starts at Beta(1,1). A completely correct single-chapter question produces Beta(2,1), mean 2/3 and variance 1/18. A second perfect question gives Beta(3,1), mean 0.75, but only two different questions remain weak evidence of broad mastery. Twenty-five varied questions across multiple days provide more useful evidence than two similar ones. Coverage and practice days remain visible rather than being collapsed into an unsupported certainty score.

For a mixed question marked 3/5, `s=0.5`. With two chapters, each receives alpha +0.25 and beta +0.25. Total added strength is still 1.

The interface shows posterior standard deviation in percentage points, not a claimed credible interval. Distinct-question count includes stable logical IDs; attempting another version of the same question is not new question diversity. Coverage is the number of distinct tagged subtopics attempted, divided by the chapter's subtopic count; it does not claim all aspects of that subtopic are mastered.

## Topic priority

Calculate priorities using the student's current local date `d` and chosen exam year:

```text
W = 1 − posterior_mean
U = min(1, 12 × posterior_variance)
R = 1, if no attempt exists
    otherwise min(1, elapsed local days / max(1, next_review − last_attempt_local_date))
E = min(1, 30 / max(1, days_to_next_relevant_exam))
    or 0 when no upcoming mapped exam date is known
P = 0.30W + 0.25U + 0.30R + 0.15E
```

Elapsed days cannot be negative. Provisional exam dates influence priority but remain labelled. Past exams do not influence `E`. The nearest future paper mapped to the chapter determines proximity, so a chapter shared by papers is not duplicated into several progress records.

For a candidate question, average the linked subtopic priority observations. A diagnostic question, linked to any chapter with fewer than three distinct questions attempted, gets a bonus `1 + 0.01 × min(5, newly assessed subtopics)`. This rewards useful initial coverage. Candidate questions must still fit the student's selections and time constraints.

Difficulty suitability is a tie-break: compare question difficulty 1–5 with `1 + 4 × mean proficiency` across its tags. This is a heuristic, not an item-response calibration.

## Queue construction

1. Remove queued entries only. Keep the active question and completed history.
2. Remaining budget is target seconds minus credited syllabus-check time and actual saved question time. Reserve the active question's estimated remaining time.
3. Eligible questions must be verified, have tags, and have every linked chapter both selected and covered. Previously retired IDs and questions attempted today are excluded. A session never contains the same stable question ID twice.
4. Select greedily, preferring questions that fit the remaining budget. If none fit, choose the shortest available question; the UI explains the overrun and allows finishing instead.
5. Among fitting candidates, penalise a third consecutive primary chapter/subject, prefer unseen questions, then sort by diagnostic/topic priority, difficulty suitability, estimated seconds and stable question ID.
6. Append the chosen question and reduce the budget. Repeat until capacity is exhausted or 40 queued entries have been considered.

For diversity, a mixed question's primary chapter/subject is the lexicographically first linked ID. This deterministic simplification does not claim a mixed question belongs exclusively to that chapter. The diversity penalty is relaxed when no fitting alternative exists.

Question estimates begin with author-supplied seconds. Where this student has previously timed that stable question, use their mean positive active duration, with a minimum of 15 seconds. Completing a question replaces its estimate with actual time in the session budget and rebuilds subsequent recommendations. Cross-student timing calibration is outside v1.

The daily target is soft: no active question is cut off. Voluntary continuation adds a planning horizon of 900 seconds once the target is reached without changing the recorded target. Queue construction is a bounded heuristic, not an optimal packing algorithm or a fixed timetable.

An interrupted question may span midnight. Its complete active duration is attributed to its local completion date in daily history; it is not split into per-minute activity records. Weekly review time is credited to the local date on which the check is finished.

## Review intervals and reuse

Review steps map to `[1, 3, 7, 14, 30, 90]` days. New chapters start at step 0. After completion:

- Correctness 1–2 resets the step to 0.
- Correctness at least 4 and ease at least 4 advance one step, capped at 5, if previous practice was on an earlier local date.
- Other outcomes retain the step. An initial attempt does not advance it, and multiple same-day successes do not accelerate it.
- Set the due date to the local completion date plus the selected interval.

Review dates contribute urgency; they are not eligibility barriers. Diagnostic uncertainty and weakness can justify earlier new questions. Missed sessions increase urgency without imposing an impossible backlog of fixed blocks.

Correctness 2–5 retires the stable question ID for that student, including later versions. Correctness 1 permits another attempt from the next local day, preferably after unseen questions. Topic retention therefore normally uses new questions testing equivalent skills, not repeated memorisation of a known solution.

## Workload communication

For each paper, count covered mapped chapters and the shortfall from three different diagnostic questions per chapter. Multiply each shortfall by that chapter's mean verified-bank duration; use 300 seconds only as an explicitly rough fallback where no bank data exists. Missing-bank chapters are disclosed.

Capacity is days until the exam times the daily minute target. This is an upper bound shared with other papers, not a promise that all time belongs to one exam. If even the estimated diagnostic work exceeds capacity, display a warning. Uncovered content, later retention, improvement practice and bank availability prevent this estimate from being a full readiness projection.

## Reproducibility and future changes

Attempts record model version `beta-v1`. Original priors and immutable question-version tags allow future administrative model replay. Future improvements should evaluate question difficulty, dependence, retention decay and confidence calibration against unseen-question outcomes before changing production recommendations. Never rewrite historical attempts merely to match a new model.
