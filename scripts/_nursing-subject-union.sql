select course_id, string_agg(distinct subject_id, ' | ' order by subject_id) as subjects
from public.questions
where is_active = true
  and course_id in ('nursing200','nursing300')
group by course_id
order by course_id;