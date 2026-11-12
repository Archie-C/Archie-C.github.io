-- Read-only installation checks. Run in the SQL Editor after 01–04.
-- RLS isolation also needs authenticated client tests: the SQL Editor is privileged.
select 'chapters' as entity,count(*) as actual,118 as expected from public.revision_chapters
union all select 'subtopics',count(*),558 from public.revision_subtopics
union all select 'books',count(*),14 from public.revision_books;

select relname as table_name,relrowsecurity as rls_enabled
from pg_class join pg_namespace n on n.oid=relnamespace
where n.nspname='public' and relname like 'revision_%' and relkind='r'
order by relname;

select has_function_privilege('anon','public.revision_api(text,jsonb)','execute') as anon_api_should_be_false,
       has_function_privilege('authenticated','public.revision_api(text,jsonb)','execute') as student_api_should_be_true,
       has_schema_privilege('authenticated','revision_private','usage') as private_usage_should_be_false,
       has_table_privilege('authenticated','public.revision_progress','update') as direct_progress_update_should_be_false;

select b.title,count(distinct c.id) as chapters,count(t.id) as subtopics
from public.revision_books b join public.revision_chapters c on c.book_id=b.id
join public.revision_subtopics t on t.chapter_id=c.id group by b.id order by b.sort_order;

select status,count(*) as question_versions from public.revision_questions group by status;

select b.title,c.title as chapter,count(distinct q.id) as verified_questions
from public.revision_chapters c join public.revision_books b on b.id=c.book_id
left join public.revision_subtopics t on t.chapter_id=c.id
left join public.revision_question_subtopics x on x.subtopic_id=t.id
left join public.revision_questions q on (q.id,q.version)=(x.question_id,x.question_version) and q.status='verified'
group by b.id,c.id order by b.sort_order,c.number;
