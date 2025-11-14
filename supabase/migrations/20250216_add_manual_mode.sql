alter table public.restaurants
  add column if not exists manual_mode boolean not null default false;
