-- Sync this specific user from auth.users to mbg_users
SELECT sync_user_from_auth('b030496a-e414-449e-b23b-c26ec6bb964a');

-- Verify the user now exists in mbg_users
SELECT 
  id,
  email,
  role_type,
  user_roles,
  is_active
FROM public.mbg_users
WHERE id = 'b030496a-e414-449e-b23b-c26ec6bb964a';
