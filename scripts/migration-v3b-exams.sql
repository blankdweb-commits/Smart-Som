alter table public.exams add column if not exists venue text default '';
alter table public.exams add column if not exists lecturer text default '';
alter table public.exams add column if not exists type text not null default 'Written';
alter table public.exams add column if not exists priority text not null default 'Medium';
alter table public.exams add column if not exists notes text default '';
alter table public.exams add column if not exists study_materials text default '';
alter table public.exams add column if not exists reminders jsonb not null default '["1 day before"]'::jsonb;
