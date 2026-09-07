select course_id, count(*) from public.questions group by course_id order by count(*) desc;
select count(*) as total_questions from public.questions;
select course_id, count(*) from public.questions group by course_id;