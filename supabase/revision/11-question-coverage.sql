-- Apply after 10-question-metadata.sql. Read-only, admin-only coverage totals.
begin;

create or replace function public.revision_admin_coverage() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.revision_is_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  return (
    with latest as (
      select distinct on (id) id,version,status from public.revision_questions order by id,version desc
    ), ready as (
      -- An older published version remains usable while its replacement is a draft.
      -- Any archived tag makes the entire question unavailable to practice.
      select q.id,q.version from public.revision_questions q
      where q.status='verified' and not exists (
        select 1 from public.revision_question_subtopics x
        join public.revision_subtopics t on t.id=x.subtopic_id
        join public.revision_chapters c on c.id=t.chapter_id
        where (x.question_id,x.question_version)=(q.id,q.version) and (t.archived or c.archived)
      )
    ), counts as (
      select x.subtopic_id,
        count(distinct x.question_id) filter (where r.id is not null) as verified,
        count(distinct x.question_id) filter (where l.status='draft') as drafts
      from public.revision_question_subtopics x
      left join ready r on (r.id,r.version)=(x.question_id,x.question_version)
      left join latest l on (l.id,l.version)=(x.question_id,x.question_version)
      group by x.subtopic_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,
      'verified',coalesce(n.verified,0),'drafts',coalesce(n.drafts,0)) order by t.id),'[]'::jsonb)
    from public.revision_subtopics t
    join public.revision_chapters c on c.id=t.chapter_id
    left join counts n on n.subtopic_id=t.id
    where not t.archived and not c.archived
  );
end $$;
revoke all on function public.revision_admin_coverage() from public,anon,authenticated;
grant execute on function public.revision_admin_coverage() to authenticated;

commit;
