select string_agg(distinct subject_id, ' | ' order by subject_id) as subjects
from public.questions
where is_active = true and course_id = 'midwifery300';