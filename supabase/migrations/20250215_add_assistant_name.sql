-- Add assistant_name column to restaurants table for greeting customization
alter table public.restaurants
  add column if not exists assistant_name text;

comment on column public.restaurants.assistant_name is 'Name of the AI assistant for personalized greetings (e.g., "Sarah", "Alex")';

