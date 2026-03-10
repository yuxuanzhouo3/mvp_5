-- ============================================================================
-- MVP5 Supabase 专用修复迁移：删除后重注册报错（Database error saving new user）
-- 说明：
-- 1) 仅在 Supabase Postgres 执行
-- 2) 修复场景：auth.users 删除后，public.app_users 残留同邮箱导致唯一键冲突
-- 3) 策略：保留历史行但清空 orphan 邮箱占位；并在 auth 删除时自动释放邮箱占位
-- ============================================================================

-- 1) 更新 auth 同步函数：
--    - INSERT/UPDATE 前，释放同邮箱的历史占位（source='global' 且 id 不同）
--    - DELETE 时释放当前用户邮箱占位，避免后续重注册冲突
CREATE OR REPLACE FUNCTION public.sync_supabase_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_provider TEXT;
  v_provider_mapped TEXT;
  v_name TEXT;
  v_avatar TEXT;
  v_email_normalized TEXT;
  v_identity_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.app_users
    SET
      email = NULL,
      email_normalized = NULL,
      is_active = FALSE,
      updated_at = NOW()
    WHERE id = OLD.id::text
      AND source = 'global';

    UPDATE public.user_auth_identities
    SET
      provider_email = NULL,
      last_login_at = NOW()
    WHERE source = 'global'
      AND (user_id = OLD.id::text OR provider_user_id = OLD.id::text);

    RETURN OLD;
  END IF;

  v_provider := LOWER(COALESCE(NEW.raw_app_meta_data->>'provider', 'email'));

  v_provider_mapped := CASE
    WHEN v_provider = 'google' THEN 'google'
    ELSE 'supabase_email'
  END;

  v_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    CASE
      WHEN NEW.email IS NOT NULL THEN SPLIT_PART(NEW.email, '@', 1)
      ELSE 'user'
    END
  );

  v_avatar := COALESCE(NULLIF(NEW.raw_user_meta_data->>'avatar_url', ''), '');

  v_email_normalized := CASE
    WHEN NEW.email IS NULL THEN NULL
    ELSE LOWER(TRIM(NEW.email))
  END;

  -- 先释放历史占位（避免 unique(source, email_normalized) 冲突）
  IF v_email_normalized IS NOT NULL THEN
    UPDATE public.app_users
    SET
      email = NULL,
      email_normalized = NULL,
      is_active = FALSE,
      updated_at = NOW()
    WHERE source = 'global'
      AND email_normalized = v_email_normalized
      AND id <> NEW.id::text;
  END IF;

  -- upsert app_users
  INSERT INTO public.app_users (
    id,
    source,
    email,
    email_normalized,
    display_name,
    avatar_url,
    is_active,
    last_login_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id::text,
    'global',
    NEW.email,
    v_email_normalized,
    v_name,
    v_avatar,
    TRUE,
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    email_normalized = EXCLUDED.email_normalized,
    display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), public.app_users.display_name),
    avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), public.app_users.avatar_url),
    is_active = TRUE,
    last_login_at = NOW(),
    updated_at = NOW();

  -- upsert user_auth_identities
  v_identity_id := CASE
    WHEN v_provider_mapped = 'google' THEN 'iden_google_' || NEW.id::text
    ELSE 'iden_email_' || NEW.id::text
  END;

  INSERT INTO public.user_auth_identities (
    id,
    user_id,
    source,
    provider,
    provider_user_id,
    provider_email,
    is_primary,
    verified_at,
    last_login_at,
    metadata_json,
    created_at
  )
  VALUES (
    v_identity_id,
    NEW.id::text,
    'global',
    v_provider_mapped,
    NEW.id::text,
    NEW.email,
    FALSE,
    NOW(),
    NOW(),
    NEW.raw_user_meta_data::json,
    NOW()
  )
  ON CONFLICT (source, provider, provider_user_id) DO UPDATE SET
    provider_email = EXCLUDED.provider_email,
    last_login_at = NOW(),
    metadata_json = EXCLUDED.metadata_json;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2) 删除触发器：auth 删除时同步释放 app_users 邮箱占位
DROP TRIGGER IF EXISTS trg_sync_supabase_auth_user_delete ON auth.users;
CREATE TRIGGER trg_sync_supabase_auth_user_delete
AFTER DELETE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_supabase_auth_user();

-- 3) 一次性回填：释放“已无 auth.users 对应”的 orphan 全局邮箱占位
UPDATE public.app_users au
SET
  email = NULL,
  email_normalized = NULL,
  is_active = FALSE,
  updated_at = NOW()
WHERE au.source = 'global'
  AND au.email_normalized IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id::text = au.id
  );

