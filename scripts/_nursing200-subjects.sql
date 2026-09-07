select course_id, subject_id, count(*) as n
from public.questions
where course_id = 'nursing200'
group by course_id, subject_id
order by subject_id;