-- Creates (or resets the password for) a real Supabase Auth user for
-- bodagoera@gmail.com / @1997God, and grants it the 'developer' role in
-- mbg_users (bodago's dev-panel gate — see DeveloperDashboard.tsx and
-- App.tsx's role_type check).
--
-- Run this once in the Supabase SQL Editor for this project
-- (https://hswxazpxcgtqbxeqcxxw.supabase.co -> SQL Editor), AFTER
-- backend/database/ADD_DEVELOPER_SELF_SERVICE_ACCESS.sql.
--
-- Mirrors digital-city-era's CREATE_DEV_PANEL_USER.sql / new
-- CREATE_SUPERMARTKERA_DEV_USER.sql for the same @1997God dev-account
-- convention, on the bodago side of the shared Supabase project.

do $$
declare
  v_user_id uuid;
  v_email    text := 'bodagoera@gmail.com';
  v_password text := '@1997God';
begin
  select id into v_user_id from auth.users where lower(email) = lower(v_email);

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, confirmation_token, recovery_token,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, crypt(v_password, gen_salt('bf')),
      now(), '', '',
      '{"provider":"email","providers":["email"]}', '{"full_name":"Bodago Dev"}',
      now(), now()
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', now(), now(), now()
    );

    raise notice 'Created new auth user % (%)', v_email, v_user_id;
  else
    update auth.users
      set encrypted_password = crypt(v_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = v_user_id;

    raise notice 'Updated password for existing auth user % (%)', v_email, v_user_id;
  end if;

  -- handle_new_auth_user_mbg() (01_users.sql) only auto-assigns 'developer'
  -- to the hardcoded abanabaasa2@gmail.com and creates this row as
  -- 'customer' for everyone else (including on the insert above, or
  -- already existing from a prior run) — explicitly promote it here.
  insert into public.mbg_users (id, email, role_type, is_active)
  values (v_user_id, v_email, 'developer', true)
  on conflict (id) do update
    set role_type = 'developer',
        is_active = true,
        updated_at = now();

  raise notice 'Granted developer role to % (%)', v_email, v_user_id;
end $$;
