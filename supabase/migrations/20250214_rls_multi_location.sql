-- Enable RLS on tables that need it for multi-location support
alter table public.restaurant_pos_locations enable row level security;
alter table public.pos_oauth_sessions enable row level security;
alter table public.restaurants enable row level security;
alter table public.app_users enable row level security;
alter table public.refresh_tokens enable row level security;

-- RLS policies for restaurant_pos_locations
-- Restaurant admins can only access their own restaurant's locations
create policy "Restaurant locations accessible by tenant" 
  on public.restaurant_pos_locations
  for all
  to authenticated
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);

-- RLS policies for pos_oauth_sessions (temporary OAuth data)
-- Restaurant admins can only access their own OAuth sessions
create policy "OAuth sessions accessible by tenant"
  on public.pos_oauth_sessions
  for all
  to authenticated
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);

-- RLS policies for restaurants
-- Restaurant admins can only access their own restaurant
-- Platform admins (null tenant_id) can access all
create policy "Restaurants accessible by tenant"
  on public.restaurants
  for all
  to authenticated
  using (
    (select current_setting('app.tenant_id', true)) is null OR
    id = current_setting('app.tenant_id', true)::uuid
  );

-- RLS policies for app_users
-- Users can only access their own user record or users from their restaurant
-- Platform admins can access all
create policy "Users accessible by tenant"
  on public.app_users
  for all
  to authenticated
  using (
    (select current_setting('app.tenant_id', true)) is null OR
    id = (select auth.uid()::text)::uuid OR
    restaurant_id = current_setting('app.tenant_id', true)::uuid
  );

-- RLS policies for refresh_tokens
-- Users can only access their own refresh tokens
create policy "Refresh tokens accessible by user"
  on public.refresh_tokens
  for all
  to authenticated
  using (user_id = (select auth.uid()::text)::uuid);

-- Add index on location_id columns for better query performance
create index if not exists idx_orders_location_id 
  on public.orders(location_id) 
  where location_id is not null;

create index if not exists idx_menu_items_location_id 
  on public.menu_items(location_id) 
  where location_id is not null;

create index if not exists idx_call_logs_location_id 
  on public.call_logs(location_id) 
  where location_id is not null;

create index if not exists idx_pos_sync_log_location_id 
  on public.pos_sync_log(location_id) 
  where location_id is not null;

-- Index for restaurant_pos_locations lookups
create index if not exists idx_restaurant_pos_locations_restaurant_pos 
  on public.restaurant_pos_locations(restaurant_id, pos_type, is_active);

create index if not exists idx_restaurant_pos_locations_vapi_phone 
  on public.restaurant_pos_locations(vapi_phone_number) 
  where vapi_phone_number is not null;

