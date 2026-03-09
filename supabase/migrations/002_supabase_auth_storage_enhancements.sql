-- ============================================================================
-- MVP5 Supabase 专用增强迁移
-- 说明：
-- 1) 本文件只在 Supabase Postgres 执行
-- 2) 与 001_unified_cross_db_schema.sql 配套
-- 3) 不改变核心表结构，只补充 Supabase Auth / RLS / Storage 策略
-- ============================================================================

-- ============================================================================
-- 1) Auth 同步：auth.users -> app_users / user_auth_identities
-- ============================================================================

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

DROP TRIGGER IF EXISTS trg_sync_supabase_auth_user_insert ON auth.users;
CREATE TRIGGER trg_sync_supabase_auth_user_insert
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_supabase_auth_user();

DROP TRIGGER IF EXISTS trg_sync_supabase_auth_user_update ON auth.users;
CREATE TRIGGER trg_sync_supabase_auth_user_update
AFTER UPDATE ON auth.users
FOR EACH ROW
WHEN (
  OLD.email IS DISTINCT FROM NEW.email
  OR OLD.raw_user_meta_data IS DISTINCT FROM NEW.raw_user_meta_data
  OR OLD.raw_app_meta_data IS DISTINCT FROM NEW.raw_app_meta_data
)
EXECUTE FUNCTION public.sync_supabase_auth_user();

-- 回填已有 Supabase 用户
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
SELECT
  au.id::text,
  'global',
  au.email,
  CASE WHEN au.email IS NULL THEN NULL ELSE LOWER(TRIM(au.email)) END,
  COALESCE(
    NULLIF(au.raw_user_meta_data->>'full_name', ''),
    NULLIF(au.raw_user_meta_data->>'name', ''),
    CASE WHEN au.email IS NOT NULL THEN SPLIT_PART(au.email, '@', 1) ELSE 'user' END
  ),
  COALESCE(NULLIF(au.raw_user_meta_data->>'avatar_url', ''), ''),
  TRUE,
  NOW(),
  COALESCE(au.created_at, NOW()),
  NOW()
FROM auth.users au
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  email_normalized = EXCLUDED.email_normalized,
  display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), public.app_users.display_name),
  avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), public.app_users.avatar_url),
  updated_at = NOW();

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
SELECT
  CASE
    WHEN LOWER(COALESCE(au.raw_app_meta_data->>'provider', 'email')) = 'google'
      THEN 'iden_google_' || au.id::text
    ELSE 'iden_email_' || au.id::text
  END AS id,
  au.id::text AS user_id,
  'global' AS source,
  CASE
    WHEN LOWER(COALESCE(au.raw_app_meta_data->>'provider', 'email')) = 'google'
      THEN 'google'
    ELSE 'supabase_email'
  END AS provider,
  au.id::text AS provider_user_id,
  au.email AS provider_email,
  FALSE,
  NOW(),
  NOW(),
  au.raw_user_meta_data::json,
  NOW()
FROM auth.users au
ON CONFLICT (source, provider, provider_user_id) DO UPDATE SET
  provider_email = EXCLUDED.provider_email,
  last_login_at = NOW(),
  metadata_json = EXCLUDED.metadata_json;

-- ============================================================================
-- 2) RLS（Supabase）
-- ============================================================================

-- 先统一开启核心业务表 RLS，避免 Dashboard 显示 UNRESTRICTED
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_package_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_change_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_quota_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_quota_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_quota_change_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_addon_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_task_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_detection_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own_profile" ON public.app_users;
CREATE POLICY "users_select_own_profile" ON public.app_users
FOR SELECT TO authenticated
USING (auth.uid()::text = id);

DROP POLICY IF EXISTS "users_update_own_profile" ON public.app_users;
CREATE POLICY "users_update_own_profile" ON public.app_users
FOR UPDATE TO authenticated
USING (auth.uid()::text = id)
WITH CHECK (auth.uid()::text = id);

DROP POLICY IF EXISTS "users_select_own_identities" ON public.user_auth_identities;
CREATE POLICY "users_select_own_identities" ON public.user_auth_identities
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_tasks" ON public.ai_tasks;
CREATE POLICY "users_select_own_tasks" ON public.ai_tasks
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_insert_own_tasks" ON public.ai_tasks;
CREATE POLICY "users_insert_own_tasks" ON public.ai_tasks
FOR INSERT TO authenticated
WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_update_own_tasks" ON public.ai_tasks;
CREATE POLICY "users_update_own_tasks" ON public.ai_tasks
FOR UPDATE TO authenticated
USING (auth.uid()::text = user_id)
WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_outputs" ON public.ai_task_outputs;
CREATE POLICY "users_select_own_outputs" ON public.ai_task_outputs
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_files" ON public.storage_files;
CREATE POLICY "users_select_own_files" ON public.storage_files
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_insert_own_files" ON public.storage_files;
CREATE POLICY "users_insert_own_files" ON public.storage_files
FOR INSERT TO authenticated
WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_update_own_files" ON public.storage_files;
CREATE POLICY "users_update_own_files" ON public.storage_files
FOR UPDATE TO authenticated
USING (auth.uid()::text = user_id)
WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_orders" ON public.orders;
CREATE POLICY "users_select_own_orders" ON public.orders
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_subscriptions" ON public.user_subscriptions;
CREATE POLICY "users_select_own_subscriptions" ON public.user_subscriptions
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_addon_purchases" ON public.user_addon_purchases;
CREATE POLICY "users_select_own_addon_purchases" ON public.user_addon_purchases
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_quota_accounts" ON public.user_quota_accounts;
CREATE POLICY "users_select_own_quota_accounts" ON public.user_quota_accounts
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_quota_balances" ON public.user_quota_balances;
CREATE POLICY "users_select_own_quota_balances" ON public.user_quota_balances
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_quota_accounts qa
    WHERE qa.id = quota_account_id
      AND qa.user_id = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "users_select_own_quota_logs" ON public.user_quota_change_logs;
CREATE POLICY "users_select_own_quota_logs" ON public.user_quota_change_logs
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_detection_reports" ON public.ai_detection_reports;
CREATE POLICY "users_select_own_detection_reports" ON public.ai_detection_reports
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_insert_own_events" ON public.analytics_events;
CREATE POLICY "users_insert_own_events" ON public.analytics_events
FOR INSERT TO authenticated
WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_select_own_sessions" ON public.analytics_sessions;
CREATE POLICY "users_select_own_sessions" ON public.analytics_sessions
FOR SELECT TO authenticated
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "users_insert_own_sessions" ON public.analytics_sessions;
CREATE POLICY "users_insert_own_sessions" ON public.analytics_sessions
FOR INSERT TO authenticated
WITH CHECK (auth.uid()::text = user_id);

-- 公开可读配置数据（前端可直接拉取）
DROP POLICY IF EXISTS "public_read_subscription_plans" ON public.subscription_plans;
CREATE POLICY "public_read_subscription_plans" ON public.subscription_plans
FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

DROP POLICY IF EXISTS "public_read_addon_packages" ON public.addon_packages;
CREATE POLICY "public_read_addon_packages" ON public.addon_packages
FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

DROP POLICY IF EXISTS "public_read_plan_prices" ON public.plan_prices;
CREATE POLICY "public_read_plan_prices" ON public.plan_prices
FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

DROP POLICY IF EXISTS "public_read_addon_package_prices" ON public.addon_package_prices;
CREATE POLICY "public_read_addon_package_prices" ON public.addon_package_prices
FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

DROP POLICY IF EXISTS "public_read_auth_provider_configs" ON public.auth_provider_configs;
CREATE POLICY "public_read_auth_provider_configs" ON public.auth_provider_configs
FOR SELECT TO anon, authenticated
USING (is_enabled = TRUE);

DROP POLICY IF EXISTS "public_read_payment_provider_configs" ON public.payment_provider_configs;
CREATE POLICY "public_read_payment_provider_configs" ON public.payment_provider_configs
FOR SELECT TO anon, authenticated
USING (is_enabled = TRUE);

DROP POLICY IF EXISTS "public_read_storage_buckets" ON public.storage_buckets;
CREATE POLICY "public_read_storage_buckets" ON public.storage_buckets
FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

DROP POLICY IF EXISTS "service_role_all_app_users" ON public.app_users;
CREATE POLICY "service_role_all_app_users" ON public.app_users
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_subscription_plans" ON public.subscription_plans;
CREATE POLICY "service_role_all_subscription_plans" ON public.subscription_plans
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_addon_packages" ON public.addon_packages;
CREATE POLICY "service_role_all_addon_packages" ON public.addon_packages
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_plan_prices" ON public.plan_prices;
CREATE POLICY "service_role_all_plan_prices" ON public.plan_prices
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_addon_package_prices" ON public.addon_package_prices;
CREATE POLICY "service_role_all_addon_package_prices" ON public.addon_package_prices
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_identities" ON public.user_auth_identities;
CREATE POLICY "service_role_all_identities" ON public.user_auth_identities
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_email_verification_codes" ON public.email_verification_codes;
CREATE POLICY "service_role_all_email_verification_codes" ON public.email_verification_codes
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_user_security_events" ON public.user_security_events;
CREATE POLICY "service_role_all_user_security_events" ON public.user_security_events
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_auth_provider_configs" ON public.auth_provider_configs;
CREATE POLICY "service_role_all_auth_provider_configs" ON public.auth_provider_configs
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_user_subscriptions" ON public.user_subscriptions;
CREATE POLICY "service_role_all_user_subscriptions" ON public.user_subscriptions
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_subscription_change_logs" ON public.subscription_change_logs;
CREATE POLICY "service_role_all_subscription_change_logs" ON public.subscription_change_logs
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_user_quota_accounts" ON public.user_quota_accounts;
CREATE POLICY "service_role_all_user_quota_accounts" ON public.user_quota_accounts
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_user_quota_balances" ON public.user_quota_balances;
CREATE POLICY "service_role_all_user_quota_balances" ON public.user_quota_balances
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_user_quota_change_logs" ON public.user_quota_change_logs;
CREATE POLICY "service_role_all_user_quota_change_logs" ON public.user_quota_change_logs
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_user_addon_purchases" ON public.user_addon_purchases;
CREATE POLICY "service_role_all_user_addon_purchases" ON public.user_addon_purchases
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_payment_provider_configs" ON public.payment_provider_configs;
CREATE POLICY "service_role_all_payment_provider_configs" ON public.payment_provider_configs
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_tasks" ON public.ai_tasks;
CREATE POLICY "service_role_all_tasks" ON public.ai_tasks
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_outputs" ON public.ai_task_outputs;
CREATE POLICY "service_role_all_outputs" ON public.ai_task_outputs
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_files" ON public.storage_files;
CREATE POLICY "service_role_all_files" ON public.storage_files
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_orders" ON public.orders;
CREATE POLICY "service_role_all_orders" ON public.orders
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_payment_transactions" ON public.payment_transactions;
CREATE POLICY "service_role_all_payment_transactions" ON public.payment_transactions
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_payment_webhook_events" ON public.payment_webhook_events;
CREATE POLICY "service_role_all_payment_webhook_events" ON public.payment_webhook_events
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_storage_buckets" ON public.storage_buckets;
CREATE POLICY "service_role_all_storage_buckets" ON public.storage_buckets
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_ai_detection_reports" ON public.ai_detection_reports;
CREATE POLICY "service_role_all_ai_detection_reports" ON public.ai_detection_reports
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_analytics_sessions" ON public.analytics_sessions;
CREATE POLICY "service_role_all_analytics_sessions" ON public.analytics_sessions
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_events" ON public.analytics_events;
CREATE POLICY "service_role_all_events" ON public.analytics_events
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_admin_users" ON public.admin_users;
CREATE POLICY "service_role_all_admin_users" ON public.admin_users
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_admin_audit_logs" ON public.admin_audit_logs;
CREATE POLICY "service_role_all_admin_audit_logs" ON public.admin_audit_logs
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- 后台公共展示策略
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_active_ads" ON public.ads;
CREATE POLICY "public_read_active_ads" ON public.ads
FOR SELECT TO anon, authenticated
USING (
  status = 'active'
  AND (start_at IS NULL OR start_at <= NOW())
  AND (end_at IS NULL OR end_at >= NOW())
);

DROP POLICY IF EXISTS "public_read_active_social_links" ON public.social_links;
CREATE POLICY "public_read_active_social_links" ON public.social_links
FOR SELECT TO anon, authenticated
USING (status = 'active');

DROP POLICY IF EXISTS "public_read_published_releases" ON public.app_releases;
CREATE POLICY "public_read_published_releases" ON public.app_releases
FOR SELECT TO anon, authenticated
USING (status = 'published');

DROP POLICY IF EXISTS "service_role_all_ads" ON public.ads;
CREATE POLICY "service_role_all_ads" ON public.ads
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_social_links" ON public.social_links;
CREATE POLICY "service_role_all_social_links" ON public.social_links
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_releases" ON public.app_releases;
CREATE POLICY "service_role_all_releases" ON public.app_releases
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- ============================================================================
-- 3) Supabase Storage 桶与策略
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('generated-outputs', 'generated-outputs', false, 524288000)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('user-avatars', 'user-avatars', true, 10485760)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('ads-media', 'ads-media', true, 104857600)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('release-packages', 'release-packages', true, 2147483648)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

-- generated-outputs：仅用户访问自己的目录
DROP POLICY IF EXISTS "gen_outputs_select_own" ON storage.objects;
CREATE POLICY "gen_outputs_select_own" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'generated-outputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "gen_outputs_insert_own" ON storage.objects;
CREATE POLICY "gen_outputs_insert_own" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'generated-outputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "gen_outputs_update_own" ON storage.objects;
CREATE POLICY "gen_outputs_update_own" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'generated-outputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'generated-outputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "gen_outputs_delete_own" ON storage.objects;
CREATE POLICY "gen_outputs_delete_own" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'generated-outputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- user-avatars：公开读，用户写自己的目录
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'user-avatars');

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'user-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'user-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'user-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'user-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 广告与发布包：公开读，service_role 管理
DROP POLICY IF EXISTS "ads_media_public_read" ON storage.objects;
CREATE POLICY "ads_media_public_read" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'ads-media');

DROP POLICY IF EXISTS "release_pkg_public_read" ON storage.objects;
CREATE POLICY "release_pkg_public_read" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'release-packages');

DROP POLICY IF EXISTS "service_role_manage_ads_media" ON storage.objects;
CREATE POLICY "service_role_manage_ads_media" ON storage.objects
FOR ALL TO service_role
USING (bucket_id = 'ads-media')
WITH CHECK (bucket_id = 'ads-media');

DROP POLICY IF EXISTS "service_role_manage_release_pkg" ON storage.objects;
CREATE POLICY "service_role_manage_release_pkg" ON storage.objects
FOR ALL TO service_role
USING (bucket_id = 'release-packages')
WITH CHECK (bucket_id = 'release-packages');

-- ============================================================================
-- 4) 授权（Supabase）
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON public.app_users TO authenticated;
GRANT SELECT ON public.user_auth_identities TO authenticated;
GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT SELECT ON public.addon_packages TO anon, authenticated;
GRANT SELECT ON public.plan_prices TO anon, authenticated;
GRANT SELECT ON public.addon_package_prices TO anon, authenticated;
GRANT SELECT ON public.auth_provider_configs TO anon, authenticated;
GRANT SELECT ON public.payment_provider_configs TO anon, authenticated;
GRANT SELECT ON public.storage_buckets TO anon, authenticated;
GRANT SELECT ON public.ads TO anon, authenticated;
GRANT SELECT ON public.social_links TO anon, authenticated;
GRANT SELECT ON public.app_releases TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_tasks TO authenticated;
GRANT SELECT ON public.ai_task_outputs TO authenticated;
GRANT SELECT ON public.ai_detection_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.storage_files TO authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.user_subscriptions TO authenticated;
GRANT SELECT ON public.user_addon_purchases TO authenticated;
GRANT SELECT ON public.user_quota_accounts TO authenticated;
GRANT SELECT ON public.user_quota_balances TO authenticated;
GRANT SELECT ON public.user_quota_change_logs TO authenticated;
GRANT SELECT, INSERT ON public.analytics_sessions TO authenticated;
GRANT INSERT ON public.analytics_events TO authenticated;

GRANT ALL PRIVILEGES ON public.subscription_plans TO service_role;
GRANT ALL PRIVILEGES ON public.addon_packages TO service_role;
GRANT ALL PRIVILEGES ON public.plan_prices TO service_role;
GRANT ALL PRIVILEGES ON public.addon_package_prices TO service_role;
GRANT ALL PRIVILEGES ON public.app_users TO service_role;
GRANT ALL PRIVILEGES ON public.user_auth_identities TO service_role;
GRANT ALL PRIVILEGES ON public.email_verification_codes TO service_role;
GRANT ALL PRIVILEGES ON public.user_security_events TO service_role;
GRANT ALL PRIVILEGES ON public.auth_provider_configs TO service_role;
GRANT ALL PRIVILEGES ON public.user_subscriptions TO service_role;
GRANT ALL PRIVILEGES ON public.subscription_change_logs TO service_role;
GRANT ALL PRIVILEGES ON public.user_quota_accounts TO service_role;
GRANT ALL PRIVILEGES ON public.user_quota_balances TO service_role;
GRANT ALL PRIVILEGES ON public.user_quota_change_logs TO service_role;
GRANT ALL PRIVILEGES ON public.user_addon_purchases TO service_role;
GRANT ALL PRIVILEGES ON public.payment_provider_configs TO service_role;
GRANT ALL PRIVILEGES ON public.ai_tasks TO service_role;
GRANT ALL PRIVILEGES ON public.ai_task_outputs TO service_role;
GRANT ALL PRIVILEGES ON public.ai_detection_reports TO service_role;
GRANT ALL PRIVILEGES ON public.storage_buckets TO service_role;
GRANT ALL PRIVILEGES ON public.storage_files TO service_role;
GRANT ALL PRIVILEGES ON public.orders TO service_role;
GRANT ALL PRIVILEGES ON public.payment_transactions TO service_role;
GRANT ALL PRIVILEGES ON public.payment_webhook_events TO service_role;
GRANT ALL PRIVILEGES ON public.analytics_sessions TO service_role;
GRANT ALL PRIVILEGES ON public.analytics_events TO service_role;
GRANT ALL PRIVILEGES ON public.admin_users TO service_role;
GRANT ALL PRIVILEGES ON public.admin_audit_logs TO service_role;
GRANT ALL PRIVILEGES ON public.ads TO service_role;
GRANT ALL PRIVILEGES ON public.social_links TO service_role;
GRANT ALL PRIVILEGES ON public.app_releases TO service_role;

-- 对敏感表进行兜底收紧（防止历史残留授权）
REVOKE ALL ON public.email_verification_codes FROM anon, authenticated;
REVOKE ALL ON public.user_security_events FROM anon, authenticated;
REVOKE ALL ON public.subscription_change_logs FROM anon, authenticated;
REVOKE ALL ON public.user_quota_change_logs FROM anon, authenticated;
REVOKE ALL ON public.payment_transactions FROM anon, authenticated;
REVOKE ALL ON public.payment_webhook_events FROM anon, authenticated;
REVOKE ALL ON public.admin_users FROM anon, authenticated;
REVOKE ALL ON public.admin_audit_logs FROM anon, authenticated;

-- ============================================================================
-- 完成
-- 你仍需在 Supabase Dashboard 启用：
-- 1) Auth -> Providers -> Google
-- 2) Auth -> Email（邮箱验证码/确认策略按业务配置）
-- ============================================================================
