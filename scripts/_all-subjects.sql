select course_id, subject_id, count(*) as n
from public.questions
where course_id in ('nursing300','midwifery','midwifery200s2','midwifery300')
group by course_id, subject_id
order by course_id, subject_id;