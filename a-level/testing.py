from datetime import datetime, timedelta

NUMBER_OF_TOPICS = {
    "Mathematics": {"Paper_1": 26, "Paper_2": 26, "Paper_3": 19},  # Pure 1 + Pure 2 + Applied
    "Further Mathematics": {"Core_1": 9, "Core_2": 8, "Stats_1": 8, "Decision_1": 8},
    "Physics": {"Paper_1": 10, "Paper_2": 10, "Paper_3": 10},
    "Computer Science": {"Paper_1": 10, "Paper_2": 10},
}

PAPER_DATES = {
    "Mathematics": {"Paper_1": datetime(2027, 5, 26), "Paper_2": datetime(2027, 6, 9), "Paper_3": datetime(2027, 6, 16)},
    "Further Mathematics": {"Core_1": datetime(2027, 5, 12), "Core_2": datetime(2027, 5, 20), "Stats_1": datetime(2027, 6, 10), "Decision_1": datetime(2027, 6, 15)},
    "Physics": {"Paper_1": datetime(2027, 5, 21), "Paper_2": datetime(2027, 5, 28), "Paper_3": datetime(2027, 6,8)},
    "Computer Science": {"Paper_1": datetime(2027,6 ,7), "Paper_2": datetime(2027,6 ,15) }, # These are prelim
}

HOURS_OF_REVISION_PER_DAY = 1
HOURS_FOR_EACH_TOPIC_EACH_DAY = 0.5

now = datetime.now()

repetition_schedule = [0, 1, 3, 7, 14, 30, 90]

def get_revision_schedule(subject, paper):
    """Schedule every topic for spaced revision before its exam.

    Return a chronological list of dictionaries containing the date, topic
    number, planned repetition offset and duration in hours. When a day is full,
    reviews are delayed until there is room. Sessions for this paper
    share the daily revision budget. Schedules for different papers must be
    combined separately if they also need to share that budget.

    Raise ValueError if the inputs are invalid or the schedule cannot fit
    every repetition before the exam.
    """
    if subject not in NUMBER_OF_TOPICS or paper not in NUMBER_OF_TOPICS[subject]:
        raise ValueError("Invalid subject or paper")

    num_topics = NUMBER_OF_TOPICS[subject][paper]
    exam_date = PAPER_DATES[subject][paper].date()
    start_date = now.date()
    session_hours = HOURS_FOR_EACH_TOPIC_EACH_DAY
    daily_hours = HOURS_OF_REVISION_PER_DAY
    intervals = sorted(repetition_schedule)

    if session_hours <= 0 or daily_hours <= 0 or session_hours > daily_hours:
        raise ValueError("Revision hours must be positive and a session must fit within a day")
    if not intervals or intervals[0] != 0 or len(set(intervals)) != len(intervals):
        raise ValueError("Repetition intervals must be unique, non-negative and include 0")
    if any(not isinstance(interval, int) or interval < 0 for interval in intervals):
        raise ValueError("Repetition intervals must be whole, non-negative days")

    # A session is indivisible: unused time cannot be split between sessions.
    sessions_per_day = int((daily_hours + 1e-9) // session_hours)
    next_topic = 1
    pending = []  # (due date, topic, repetition index, first session date)
    schedule = []
    day = start_date

    while day < exam_date and (pending or next_topic <= num_topics):
        for _ in range(sessions_per_day):
            pending.sort()
            if pending and pending[0][0] <= day:
                _, topic, repetition_index, first_day = pending.pop(0)
            elif next_topic <= num_topics:
                topic = next_topic
                next_topic += 1
                repetition_index = 0
                first_day = day
            else:
                break

            schedule.append({
                "date": day,
                "topic": topic,
                "repetition_offset": intervals[repetition_index],
                "hours": session_hours,
            })
            next_index = repetition_index + 1
            if next_index < len(intervals):
                due = first_day + timedelta(days=intervals[next_index])
                # Do not place two repetitions of the same topic on one day.
                pending.append((max(due, day + timedelta(days=1)), topic, next_index, first_day))
        day += timedelta(days=1)

    if pending or next_topic <= num_topics:
        raise ValueError(
            f"Could not fit all repetitions for {subject} {paper} before the exam "
            "with the available daily revision hours"
        )

    return schedule


def get_all_revision_schedule(start_date=None):
    """Build one timetable for all papers within the shared daily budget.

    Each topic is introduced once and then reviewed when its target interval
    comes due. Intervals are measured from its first session; a full day can
    delay a review. Due topics with fewer completed sessions are prioritised,
    followed by earlier exams and due dates. A topic gets at most one session
    per day, and no session is scheduled on or after its paper's exam.

    Return a dictionary with chronological sessions and a summary, including
    how many planned repetitions did not fit. Raise ValueError if even one
    session per topic could not be scheduled, or configuration is invalid.
    This is a heuristic: it does not prove that another allocation cannot fit
    more repetitions. Topics shared between papers are counted separately.
    """
    if start_date is None:
        start_date = datetime.now().date()
    elif isinstance(start_date, datetime):
        start_date = start_date.date()

    intervals = sorted(repetition_schedule)
    session_hours = HOURS_FOR_EACH_TOPIC_EACH_DAY
    daily_hours = HOURS_OF_REVISION_PER_DAY
    if session_hours <= 0 or daily_hours <= 0 or session_hours > daily_hours:
        raise ValueError("Revision hours must be positive and a session must fit within a day")
    if (not intervals or intervals[0] != 0 or len(set(intervals)) != len(intervals)
            or any(not isinstance(i, int) or i < 0 for i in intervals)):
        raise ValueError("Repetition intervals must be unique non-negative whole days and include 0")

    capacity = int((daily_hours + 1e-9) // session_hours)
    topics = []
    for subject, papers in NUMBER_OF_TOPICS.items():
        for paper, count in papers.items():
            exam_date = PAPER_DATES[subject][paper].date()
            if count and exam_date <= start_date:
                raise ValueError(f"No revision days remain before {subject} {paper}")
            for topic in range(1, count + 1):
                topics.append({"subject": subject, "paper": paper, "topic": topic,
                               "exam": exam_date, "first": None, "completed": 0,
                               "due": start_date, "last": None})

    if not topics:
        return {"sessions": [], "summary": {"topics": 0, "planned_sessions": 0,
                "scheduled_sessions": 0, "unscheduled_sessions": 0}}

    sessions = []
    day = start_date
    last_exam = max(topic["exam"] for topic in topics)
    while day < last_exam:
        eligible = [topic for topic in topics if topic["completed"] < len(intervals)
                    and topic["exam"] > day and topic["due"] <= day
                    and topic["last"] != day]
        eligible.sort(key=lambda topic: (topic["completed"], topic["exam"], topic["due"],
                                         topic["subject"], topic["paper"], topic["topic"]))
        for topic in eligible[:capacity]:
            index = topic["completed"]
            if index == 0:
                topic["first"] = day
            sessions.append({"date": day, "subject": topic["subject"],
                             "paper": topic["paper"], "topic": topic["topic"],
                             "repetition_offset": intervals[index], "hours": session_hours})
            topic["completed"] += 1
            topic["last"] = day
            if topic["completed"] < len(intervals):
                topic["due"] = max(day + timedelta(days=1), topic["first"] +
                                   timedelta(days=intervals[topic["completed"]]))
        day += timedelta(days=1)

    uncovered = [topic for topic in topics if not topic["completed"]]
    if uncovered:
        raise ValueError(f"Could not schedule an initial session for {len(uncovered)} topics before their exams")
    planned = len(topics) * len(intervals)
    return {"sessions": sessions, "summary": {"topics": len(topics),
            "planned_sessions": planned, "scheduled_sessions": len(sessions),
            "unscheduled_sessions": planned - len(sessions)}}


if __name__ == "__main__":
    result = get_all_revision_schedule()
    print(result["summary"])
    for session in result["sessions"]:
        print(session)
