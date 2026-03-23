-- ============================================================================
-- MVP5 Supabase 专用：app_settings 开启 RLS，关闭匿名直连访问
-- 说明：
-- 1) 仅在 Supabase Postgres 执行（CloudBase 不执行）
-- 2) 解决 Supabase Dashboard 提示 app_settings = UNRESTRICTED
-- 3) 默认仅允许 service_role 访问，前台/后台通过服务端读写
-- ============================================================================

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_app_settings" ON public.app_settings;
CREATE POLICY "service_role_all_app_settings" ON public.app_settings
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- 显式回收匿名与普通登录用户对该表的权限（配合 RLS 双保险）
REVOKE ALL ON public.app_settings FROM anon, authenticated;

