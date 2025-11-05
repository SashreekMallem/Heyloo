-- Fix RLS policy for app_users to allow refresh token lookup
-- Users need to be able to access their own record by ID during token refresh
DROP POLICY IF EXISTS "Users accessible by tenant" ON public.app_users;

-- Allow users to access:
-- 1. Their own record (by ID) - needed for refresh token lookup
-- 2. Users from their restaurant (by restaurant_id match with tenant_id)
-- 3. Platform admins can access all (when tenant_id is null)
CREATE POLICY "Users accessible by tenant"
  ON public.app_users
  FOR ALL
  TO authenticated
  USING (
    -- Platform admins (null tenant_id) can access all
    (SELECT current_setting('app.tenant_id', true)) IS NULL OR
    -- Users from the same restaurant (matched by tenant_id)
    restaurant_id = (SELECT current_setting('app.tenant_id', true))::uuid
  );

-- For refresh token lookup, we need a function that bypasses RLS
-- This function allows looking up a user by ID for token refresh purposes
CREATE OR REPLACE FUNCTION public.get_user_for_refresh(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  role text,
  restaurant_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with creator's privileges (bypasses RLS)
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.role,
    u.restaurant_id
  FROM public.app_users u
  WHERE u.id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_for_refresh(uuid) TO authenticated;

