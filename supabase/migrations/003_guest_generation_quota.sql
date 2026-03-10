-- ============================================================================
-- MVP5 Supabase 游客文档生成额度（安全限流）
-- 说明：
-- 1) 仅用于未登录游客的文档生成功能额度控制
-- 2) 通过 visitor_key_hash + month_key 做并发安全扣减
-- 3) 额度上限由服务端按环境变量传入函数（p_limit_count）
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.guest_generation_quotas (
  id BIGSERIAL PRIMARY KEY,
  month_key VARCHAR(7) NOT NULL,
  visitor_key_hash VARCHAR(128) NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  limit_count INTEGER NOT NULL DEFAULT 0,
  last_request_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (month_key, visitor_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_guest_generation_quotas_month_key
  ON public.guest_generation_quotas(month_key);

ALTER TABLE public.guest_generation_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_guest_generation_quotas" ON public.guest_generation_quotas;
CREATE POLICY "service_role_all_guest_generation_quotas" ON public.guest_generation_quotas
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.consume_guest_generation_quota(
  p_month_key TEXT,
  p_visitor_key_hash TEXT,
  p_limit_count INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  used_count INTEGER,
  limit_count INTEGER,
  remaining_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := GREATEST(COALESCE(p_limit_count, 0), 0);
  v_row public.guest_generation_quotas%ROWTYPE;
BEGIN
  IF COALESCE(TRIM(p_month_key), '') = '' THEN
    RAISE EXCEPTION 'p_month_key is required';
  END IF;

  IF COALESCE(TRIM(p_visitor_key_hash), '') = '' THEN
    RAISE EXCEPTION 'p_visitor_key_hash is required';
  END IF;

  INSERT INTO public.guest_generation_quotas (
    month_key,
    visitor_key_hash,
    used_count,
    limit_count,
    last_request_at,
    updated_at
  )
  VALUES (
    TRIM(p_month_key),
    TRIM(p_visitor_key_hash),
    CASE WHEN v_limit > 0 THEN 1 ELSE 0 END,
    v_limit,
    NOW(),
    NOW()
  )
  ON CONFLICT (month_key, visitor_key_hash)
  DO UPDATE SET
    limit_count = v_limit,
    used_count = CASE
      WHEN public.guest_generation_quotas.used_count < v_limit
        THEN public.guest_generation_quotas.used_count + 1
      ELSE public.guest_generation_quotas.used_count
    END,
    last_request_at = NOW(),
    updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN QUERY
  SELECT
    (v_row.limit_count > 0 AND v_row.used_count <= v_row.limit_count) AS allowed,
    v_row.used_count,
    v_row.limit_count,
    GREATEST(v_row.limit_count - v_row.used_count, 0) AS remaining_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_guest_generation_quota(
  p_month_key TEXT,
  p_visitor_key_hash TEXT,
  p_decrement INTEGER DEFAULT 1
)
RETURNS TABLE (
  used_count INTEGER,
  limit_count INTEGER,
  remaining_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta INTEGER := GREATEST(COALESCE(p_decrement, 1), 1);
  v_row public.guest_generation_quotas%ROWTYPE;
BEGIN
  IF COALESCE(TRIM(p_month_key), '') = '' THEN
    RAISE EXCEPTION 'p_month_key is required';
  END IF;

  IF COALESCE(TRIM(p_visitor_key_hash), '') = '' THEN
    RAISE EXCEPTION 'p_visitor_key_hash is required';
  END IF;

  UPDATE public.guest_generation_quotas
  SET
    used_count = GREATEST(used_count - v_delta, 0),
    updated_at = NOW()
  WHERE month_key = TRIM(p_month_key)
    AND visitor_key_hash = TRIM(p_visitor_key_hash)
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_row.used_count,
    v_row.limit_count,
    GREATEST(v_row.limit_count - v_row.used_count, 0) AS remaining_count;
END;
$$;

GRANT ALL PRIVILEGES ON public.guest_generation_quotas TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.guest_generation_quotas_id_seq TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_guest_generation_quota(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_guest_generation_quota(TEXT, TEXT, INTEGER) TO service_role;

REVOKE ALL ON public.guest_generation_quotas FROM anon, authenticated;
