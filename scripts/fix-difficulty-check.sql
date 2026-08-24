alter table public.custom_flashcards drop constraint if exists custom_flashcards_difficulty_check;
alter table public.custom_flashcards add constraint custom_flashcards_difficulty_check
  check (difficulty in ('Easy','Medium','Moderate','Hard','Expert','Master','Extreme'));
