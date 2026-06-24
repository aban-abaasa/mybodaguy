-- Check if this specific user exists in mbg_users
SELECT 
  id,
  email,
  role_type,
  user_roles,
  is_active,
  created_at
FROM public.mbg_users
WHERE id = 'b030496a-e414-449e-b23b-c26ec6bb964a';

-- If not found, check auth.users
SELECT 
  id,
  email,
  created_at
FROM auth.users
WHERE id = 'b030496a-e414-449e-b23b-c26ec6bb964a';
