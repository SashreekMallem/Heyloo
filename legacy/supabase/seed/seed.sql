-- Seed data for Heyloo platform
insert into public.restaurants (id, name, slug, phone_number, owner_email, subscription_status, pos_type, tax_rate, delivery_fee, stripe_account_id, stripe_customer_id, pos_location_id)
values
  ('6a3293c9-0a0d-4a68-9bf4-7c1d6f40f6fc', 'Imperial Biryani Cafe', 'imperial-biryani', '+12145551234', 'owner@imperialbiryani.com', 'active', 'square', 0.0825, 5.00, null, null, 'LOCATION-001'),
  ('b68b6a64-fc58-43c5-9e0f-dfb517ad0c60', 'Olive Garden Dallas', 'olive-garden-dallas', '+12145559876', 'manager@ogdallas.com', 'trial', 'none', 0.0825, 5.00, null, null, null)
on conflict (id) do nothing;

insert into public.app_users (email, password_hash, role, restaurant_id)
values
  ('admin@heyloo.ai', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36Z9erb3Rp3bIanFkFJxuxK', 'platform_admin', null),
  ('manager@imperialbiryani.com', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36Z9erb3Rp3bIanFkFJxuxK', 'restaurant_admin', '6a3293c9-0a0d-4a68-9bf4-7c1d6f40f6fc')
on conflict (email) do nothing;

insert into public.menu_items (restaurant_id, name, description, price, category, pos_item_id, sync_source, is_available)
values
  ('6a3293c9-0a0d-4a68-9bf4-7c1d6f40f6fc', 'Chicken Biryani', 'Long-grain basmati with spiced chicken', 14.50, 'Entrees', 'POS-CKN-BIR', 'manual', true),
  ('6a3293c9-0a0d-4a68-9bf4-7c1d6f40f6fc', 'Lamb Korma', 'Creamy cashew curry with braised lamb', 16.00, 'Entrees', 'POS-LMB-KOR', 'manual', true),
  ('6a3293c9-0a0d-4a68-9bf4-7c1d6f40f6fc', 'Garlic Naan', 'Freshly baked naan with garlic butter', 4.50, 'Sides', 'POS-GAR-NAAN', 'manual', true)
on conflict do nothing;
