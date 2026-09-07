select subject_id, count(*) as n,
  count(*) filter (where options is not null and jsonb_array_length(options) >= 2) as with_options
from public.questions
where course_id = 'nursing200'
group by subject_id
order by subject_id;