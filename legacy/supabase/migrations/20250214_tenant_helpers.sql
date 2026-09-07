create or replace function public.set_tenant_id(p_tenant_id uuid)
returns void
language sql
security definer
as $$
  select set_config('app.tenant_id', p_tenant_id::text, true);
$$;

grant execute on function public.set_tenant_id(uuid) to authenticated;

create or replace function public.clear_tenant_id()
returns void
language sql
security definer
as $$
  select set_config('app.tenant_id', null, true);
$$;

grant execute on function public.clear_tenant_id() to authenticated;
