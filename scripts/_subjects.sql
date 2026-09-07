-- subjects per level bank
select course_id, subject_id, count(*) as n
from public.questions
where course_id in ('nursing200','nursing300','nursing','midwifery200s2','midwifery300')
group by course_id, subject_id
order by course_id, subject_id;
-- difficulty spread for the two Pharmacology banks the client queried
select course_id, difficulty, count(*) as n
from public.questions
where course_id in ('nursing200','nursing300')
group by course_id, difficulty
order by course_id, difficulty;