-- Fix login function to bypass RLS for email-based lookup
-- Login needs to query users by email before authentication, so RLS blocks it
CREATE OR REPLACE FUNCTION public.get_user_for_login(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  password_hash text,
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
    u.password_hash,
    u.role,
    u.restaurant_id
  FROM public.app_users u
  WHERE u.email = p_email
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_for_login(text) TO authenticated, anon;

