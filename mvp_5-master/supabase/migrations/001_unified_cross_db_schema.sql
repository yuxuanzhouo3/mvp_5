-- ============================================================================
-- MVP5 统一数据库初始化脚本（CloudBase SQL / Supabase SQL Editor 通用）
-- 版本：v1
-- 目标：
-- 1) NEXT_PUBLIC_DEFAULT_LANGUAGE=zh -> 国内版（source='cn'）
-- 2) NEXT_PUBLIC_DEFAULT_LANGUAGE=en -> 国际版（source='global'）
-- 3) 同一份 SQL 在 CloudBase SQL（MySQL 型）与 Supabase Postgres 均可执行
--
-- 兼容性约束：
-- - 不使用仅 PostgreSQL 可用的 RLS、函数、触发器、JSONB、扩展函数
-- - 主键统一使用 VARCHAR(64)，由应用层生成 ID（UUID/ULID）
-- - JSON 字段统一使用 JSON（非 JSONB）
-- ============================================================================

-- ============================================================================
-- 1) 订阅与套餐基线
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_code VARCHAR(32) PRIMARY KEY,                 -- free / pro / enterprise
  display_name_cn VARCHAR(64) NOT NULL,
  display_name_en VARCHAR(64) NOT NULL,
  plan_level INTEGER NOT NULL,                       -- 数值越大等级越高
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  admin_adjustable BOOLEAN NOT NULL DEFAULT FALSE,   -- 管理员是否允许直接调整该套餐额度
  monthly_document_limit INTEGER NOT NULL,
  monthly_image_limit INTEGER NOT NULL,
  monthly_video_limit INTEGER NOT NULL,
  monthly_audio_limit INTEGER NOT NULL,
  description_cn TEXT,
  description_en TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS addon_packages (
  addon_code VARCHAR(32) PRIMARY KEY,                -- light / standard / premium
  display_name_cn VARCHAR(64) NOT NULL,
  display_name_en VARCHAR(64) NOT NULL,
  document_quota INTEGER NOT NULL,
  image_quota INTEGER NOT NULL,
  video_quota INTEGER NOT NULL,
  audio_quota INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2) 用户与认证
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_users (
  id VARCHAR(64) PRIMARY KEY,                        -- 与 Supabase auth uid / CloudBase user id 对齐
  source VARCHAR(16) NOT NULL DEFAULT 'global',      -- cn / global
  email VARCHAR(255),
  email_normalized VARCHAR(255),
  display_name VARCHAR(120),
  avatar_url TEXT,
  country_code VARCHAR(16),
  region VARCHAR(64),
  city VARCHAR(64),
  locale VARCHAR(16),
  timezone VARCHAR(64),
  current_plan_code VARCHAR(32) NOT NULL DEFAULT 'free',
  subscription_status VARCHAR(32) NOT NULL DEFAULT 'inactive',
  plan_started_at TIMESTAMP NULL DEFAULT NULL,
  plan_expires_at TIMESTAMP NULL DEFAULT NULL,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  extra_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, email_normalized)
);

CREATE TABLE IF NOT EXISTS user_auth_identities (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL,                       -- cn / global
  provider VARCHAR(32) NOT NULL,                     -- wechat / email_code / google / supabase_email
  provider_user_id VARCHAR(191) NOT NULL,
  provider_email VARCHAR(255),
  provider_phone VARCHAR(32),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMP NULL DEFAULT NULL,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, provider, provider_user_id),
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL,                       -- cn / global
  email VARCHAR(255) NOT NULL,
  scene VARCHAR(32) NOT NULL,                        -- signup / login / reset
  code_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TIMESTAMP NULL DEFAULT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 6,
  send_ip VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_security_events (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  source VARCHAR(16) NOT NULL,
  event_type VARCHAR(64) NOT NULL,                   -- login_success/login_failed/code_sent/password_reset...
  provider VARCHAR(32),
  success BOOLEAN NOT NULL DEFAULT TRUE,
  ip_address VARCHAR(64),
  user_agent TEXT,
  detail_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS auth_provider_configs (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL,                       -- cn / global
  provider VARCHAR(32) NOT NULL,                     -- wechat / email_code / google / supabase_email
  display_name VARCHAR(64) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, provider)
);

-- ============================================================================
-- 3) 套餐价格、订阅、额度
-- ============================================================================

CREATE TABLE IF NOT EXISTS plan_prices (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL,                       -- cn / global
  plan_code VARCHAR(32) NOT NULL,
  billing_period VARCHAR(16) NOT NULL,               -- monthly / yearly
  currency VARCHAR(16) NOT NULL,                     -- CNY / USD
  amount DECIMAL(12,2) NOT NULL,
  original_amount DECIMAL(12,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, plan_code, billing_period, currency),
  FOREIGN KEY (plan_code) REFERENCES subscription_plans(plan_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS addon_package_prices (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL,                       -- cn / global
  addon_code VARCHAR(32) NOT NULL,
  currency VARCHAR(16) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, addon_code, currency),
  FOREIGN KEY (addon_code) REFERENCES addon_packages(addon_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL,
  plan_code VARCHAR(32) NOT NULL,
  billing_period VARCHAR(16) NOT NULL,               -- monthly / yearly
  status VARCHAR(32) NOT NULL,                       -- trialing / active / past_due / canceled / expired
  provider VARCHAR(32),                              -- wechat_pay / alipay / stripe / paypal
  provider_subscription_id VARCHAR(191),
  latest_order_id VARCHAR(64),
  start_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_period_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_period_end TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at TIMESTAMP NULL DEFAULT NULL,
  trial_end_at TIMESTAMP NULL DEFAULT NULL,
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_code) REFERENCES subscription_plans(plan_code)
);

CREATE TABLE IF NOT EXISTS subscription_change_logs (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL,
  action VARCHAR(32) NOT NULL,                       -- activate/renew/upgrade/downgrade/cancel/expire/admin_adjust
  from_plan_code VARCHAR(32),
  to_plan_code VARCHAR(32),
  from_period_end TIMESTAMP NULL DEFAULT NULL,
  to_period_end TIMESTAMP NULL DEFAULT NULL,
  reason TEXT,
  operator_type VARCHAR(16) NOT NULL,               -- user / admin / system / webhook
  operator_id VARCHAR(64),
  related_order_id VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_quota_accounts (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL,
  plan_code VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',      -- active / expired / archived
  cycle_type VARCHAR(16) NOT NULL DEFAULT 'monthly',
  cycle_start_date DATE NOT NULL,
  cycle_end_date DATE NOT NULL,
  next_reset_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, source, cycle_start_date, cycle_end_date),
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_code) REFERENCES subscription_plans(plan_code)
);

CREATE TABLE IF NOT EXISTS user_quota_balances (
  id VARCHAR(64) PRIMARY KEY,
  quota_account_id VARCHAR(64) NOT NULL,
  quota_type VARCHAR(16) NOT NULL,                   -- document / image / video / audio
  base_limit INTEGER NOT NULL,
  addon_limit INTEGER NOT NULL DEFAULT 0,
  admin_adjustment INTEGER NOT NULL DEFAULT 0,
  used_amount INTEGER NOT NULL DEFAULT 0,
  remaining_amount INTEGER,
  last_consumed_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (quota_account_id, quota_type),
  FOREIGN KEY (quota_account_id) REFERENCES user_quota_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_quota_change_logs (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL,
  quota_type VARCHAR(16) NOT NULL,                   -- document / image / video / audio
  change_kind VARCHAR(32) NOT NULL,                  -- init/consume/refund/addon_grant/admin_adjust/cycle_reset/plan_switch
  delta_amount INTEGER NOT NULL,
  before_amount INTEGER NOT NULL,
  after_amount INTEGER NOT NULL,
  reference_type VARCHAR(32),
  reference_id VARCHAR(64),
  operator_type VARCHAR(16) NOT NULL,               -- user / admin / system / webhook
  operator_id VARCHAR(64),
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_addon_purchases (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL,
  addon_code VARCHAR(32) NOT NULL,
  order_id VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'pending',     -- pending / paid / canceled / refunded / expired
  granted_at TIMESTAMP NULL DEFAULT NULL,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_id),
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (addon_code) REFERENCES addon_packages(addon_code)
);

-- ============================================================================
-- 4) 支付与订单
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_provider_configs (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL,                       -- cn / global
  provider VARCHAR(32) NOT NULL,                     -- wechat_pay / alipay / stripe / paypal
  display_name VARCHAR(64) NOT NULL,
  supports_subscription BOOLEAN NOT NULL DEFAULT TRUE,
  supports_refund BOOLEAN NOT NULL DEFAULT TRUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, provider)
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(64),
  source VARCHAR(16) NOT NULL,                       -- cn / global
  order_type VARCHAR(32) NOT NULL,                   -- subscription / addon / one_time / upgrade
  product_code VARCHAR(64),
  product_name VARCHAR(128) NOT NULL,
  plan_code VARCHAR(32),
  billing_period VARCHAR(16),
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(16) NOT NULL,
  original_amount DECIMAL(12,2),
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_provider VARCHAR(32),                      -- wechat_pay / alipay / stripe / paypal
  payment_method VARCHAR(32),
  payment_status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending / paid / failed / refunded / canceled
  paid_at TIMESTAMP NULL DEFAULT NULL,
  provider_order_id VARCHAR(191),
  provider_transaction_id VARCHAR(191),
  idempotency_key VARCHAR(191),
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_level VARCHAR(16) NOT NULL DEFAULT 'low',
  risk_factors_json JSON,
  ip_address VARCHAR(64),
  device_fingerprint VARCHAR(191),
  user_agent TEXT,
  country_code VARCHAR(16),
  region_name VARCHAR(64),
  city VARCHAR(64),
  refund_status VARCHAR(16),
  refund_amount DECIMAL(12,2),
  refund_reason TEXT,
  refunded_at TIMESTAMP NULL DEFAULT NULL,
  extra_json JSON,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, payment_provider, provider_order_id),
  UNIQUE (idempotency_key),
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64),
  source VARCHAR(16) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  transaction_type VARCHAR(32) NOT NULL,             -- charge / refund / webhook
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL,                       -- pending / success / failed / refunded
  provider_order_id VARCHAR(191),
  provider_transaction_id VARCHAR(191),
  provider_event_id VARCHAR(191),
  request_payload_json JSON,
  response_payload_json JSON,
  error_code VARCHAR(64),
  error_message TEXT,
  processed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_transaction_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  event_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  event_time TIMESTAMP NULL DEFAULT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  processing_status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending / processed / ignored / failed
  payload_json JSON,
  error_message TEXT,
  related_order_id VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, provider, event_id),
  FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL
);

-- ============================================================================
-- 5) 文件存储与 AI 任务历史
-- ============================================================================

CREATE TABLE IF NOT EXISTS storage_buckets (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL,                       -- cn / global
  provider VARCHAR(32) NOT NULL,                     -- cloudbase / supabase
  bucket_name VARCHAR(128) NOT NULL,
  purpose VARCHAR(32) NOT NULL,                      -- generated_output / avatar / ads_media / release_package
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  max_file_size_bytes BIGINT,
  allowed_mime_types_json JSON,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, provider, bucket_name)
);

CREATE TABLE IF NOT EXISTS storage_files (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  source VARCHAR(16) NOT NULL,
  provider VARCHAR(32) NOT NULL,                     -- cloudbase / supabase
  bucket_name VARCHAR(128) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128),
  file_size_bytes BIGINT,
  checksum_sha256 VARCHAR(128),
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  public_url TEXT,
  storage_status VARCHAR(32) NOT NULL DEFAULT 'active', -- active / archived / deleted
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, provider, bucket_name, object_key),
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_tasks (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  source VARCHAR(16) NOT NULL,                       -- cn / global
  task_category VARCHAR(16) NOT NULL,                -- generate / edit / detect
  task_type VARCHAR(32) NOT NULL,                    -- text/image/audio/video/edit_*/detect_*
  model_id VARCHAR(128),
  model_label VARCHAR(128),
  model_provider VARCHAR(32),                        -- aliyun / replicate / mistral / demo
  request_prompt TEXT,
  request_params_json JSON,
  input_file_id VARCHAR(64),
  status VARCHAR(16) NOT NULL,                       -- pending / running / success / failed / canceled
  summary TEXT,
  error_message TEXT,
  started_at TIMESTAMP NULL DEFAULT NULL,
  finished_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (input_file_id) REFERENCES storage_files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_task_outputs (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64),
  source VARCHAR(16) NOT NULL,
  output_type VARCHAR(32) NOT NULL,                  -- text / document / image / audio / video / detect_report
  sequence_no INTEGER NOT NULL DEFAULT 1,
  text_content TEXT,
  file_id VARCHAR(64),
  preview_url TEXT,
  download_url TEXT,
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (task_id, output_type, sequence_no),
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (file_id) REFERENCES storage_files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_detection_reports (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(64),
  source VARCHAR(16) NOT NULL,
  target_type VARCHAR(16) NOT NULL,                  -- text / image / audio / video
  confidence_score DECIMAL(5,2),
  risk_level VARCHAR(16),                            -- low / medium / high
  verdict VARCHAR(32),                               -- ai_generated / human / uncertain
  report_text TEXT,
  evidence_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

-- ============================================================================
-- 6) 埋点与统计
-- ============================================================================

CREATE TABLE IF NOT EXISTS analytics_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  source VARCHAR(16) NOT NULL,                       -- cn / global
  session_id VARCHAR(128) NOT NULL UNIQUE,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL DEFAULT NULL,
  device_type VARCHAR(32),
  os VARCHAR(32),
  browser VARCHAR(32),
  app_version VARCHAR(32),
  country_code VARCHAR(16),
  region VARCHAR(64),
  city VARCHAR(64),
  ip_address VARCHAR(64),
  user_agent TEXT,
  referrer TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  source VARCHAR(16) NOT NULL,                       -- cn / global
  session_id VARCHAR(128),
  event_type VARCHAR(64) NOT NULL,                   -- page_view / generate_start / generate_success / payment / subscription...
  event_name VARCHAR(128),
  page_path VARCHAR(255),
  related_task_id VARCHAR(64),
  related_order_id VARCHAR(64),
  event_value DECIMAL(12,2),
  event_data_json JSON,
  device_type VARCHAR(32),
  os VARCHAR(32),
  browser VARCHAR(32),
  app_version VARCHAR(32),
  country_code VARCHAR(16),
  region VARCHAR(64),
  city VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (related_task_id) REFERENCES ai_tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL
);

-- ============================================================================
-- 7) 后台管理系统（广告、社交链接、版本、交易审计）
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(120),
  email VARCHAR(255),
  role VARCHAR(32) NOT NULL DEFAULT 'admin',         -- admin / super_admin / operator
  status VARCHAR(16) NOT NULL DEFAULT 'active',      -- active / disabled
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  admin_user_id VARCHAR(64),
  action VARCHAR(64) NOT NULL,                       -- update_plan_quota / update_user_quota / publish_release ...
  target_type VARCHAR(64) NOT NULL,                  -- subscription_plans / app_users / ads / orders ...
  target_id VARCHAR(64),
  source VARCHAR(16),                                -- cn / global / all
  before_json JSON,
  after_json JSON,
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ads (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL DEFAULT 'global',      -- cn / global / all
  title VARCHAR(128) NOT NULL,
  description TEXT,
  media_type VARCHAR(16) NOT NULL DEFAULT 'image',   -- image / video
  media_file_id VARCHAR(64),
  media_url TEXT,
  thumbnail_url TEXT,
  link_url TEXT,
  link_type VARCHAR(16) DEFAULT 'external',          -- external / internal / download
  position VARCHAR(16) NOT NULL DEFAULT 'bottom',    -- left / right / top / bottom
  platform VARCHAR(32) NOT NULL DEFAULT 'all',       -- all / web / android / ios / desktop
  status VARCHAR(16) NOT NULL DEFAULT 'active',      -- active / inactive / scheduled
  priority INTEGER NOT NULL DEFAULT 0,
  start_at TIMESTAMP NULL DEFAULT NULL,
  end_at TIMESTAMP NULL DEFAULT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_file_id) REFERENCES storage_files(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS social_links (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL DEFAULT 'global',      -- cn / global
  name VARCHAR(64) NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  icon_file_id VARCHAR(64),
  icon_url TEXT,
  platform_type VARCHAR(32) NOT NULL,                -- wechat / weibo / x / youtube / github ...
  status VARCHAR(16) NOT NULL DEFAULT 'active',      -- active / inactive
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (icon_file_id) REFERENCES storage_files(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_releases (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(16) NOT NULL DEFAULT 'global',      -- cn / global
  platform VARCHAR(32) NOT NULL,                     -- android / ios / windows / macos / linux / harmonyos
  version VARCHAR(64) NOT NULL,
  version_code INTEGER NOT NULL,
  title VARCHAR(128) NOT NULL,
  description TEXT,
  release_notes TEXT,
  release_file_id VARCHAR(64),
  download_url TEXT,
  backup_download_url TEXT,
  file_size_bytes BIGINT,
  file_hash VARCHAR(128),
  status VARCHAR(16) NOT NULL DEFAULT 'draft',       -- draft / published / deprecated
  is_force_update BOOLEAN NOT NULL DEFAULT FALSE,
  min_supported_version VARCHAR(64),
  published_at TIMESTAMP NULL DEFAULT NULL,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, platform, version),
  FOREIGN KEY (release_file_id) REFERENCES storage_files(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
);

-- ============================================================================
-- 8) 索引
-- ============================================================================

CREATE INDEX idx_users_source_plan ON app_users(source, current_plan_code);
CREATE INDEX idx_users_source_created ON app_users(source, created_at);

CREATE INDEX idx_user_auth_user_provider ON user_auth_identities(user_id, provider);
CREATE INDEX idx_user_auth_source_provider ON user_auth_identities(source, provider);

CREATE INDEX idx_email_code_lookup ON email_verification_codes(source, email, scene, expires_at);
CREATE INDEX idx_security_events_user_time ON user_security_events(user_id, created_at);
CREATE INDEX idx_security_events_source_type_time ON user_security_events(source, event_type, created_at);

CREATE INDEX idx_plan_prices_source_plan_period ON plan_prices(source, plan_code, billing_period);
CREATE INDEX idx_addon_prices_source_code ON addon_package_prices(source, addon_code);

CREATE INDEX idx_sub_user_status_end ON user_subscriptions(user_id, status, current_period_end);
CREATE INDEX idx_sub_source_status_end ON user_subscriptions(source, status, current_period_end);
CREATE INDEX idx_sub_provider_sid ON user_subscriptions(provider, provider_subscription_id);

CREATE INDEX idx_sub_change_user_time ON subscription_change_logs(user_id, created_at);
CREATE INDEX idx_sub_change_source_action_time ON subscription_change_logs(source, action, created_at);

CREATE INDEX idx_quota_account_user_source_status ON user_quota_accounts(user_id, source, status);
CREATE INDEX idx_quota_balance_type_remaining ON user_quota_balances(quota_type, remaining_amount);
CREATE INDEX idx_quota_log_user_type_time ON user_quota_change_logs(user_id, quota_type, created_at);
CREATE INDEX idx_quota_log_source_kind_time ON user_quota_change_logs(source, change_kind, created_at);

CREATE INDEX idx_addon_purchase_user_status_time ON user_addon_purchases(user_id, status, created_at);
CREATE INDEX idx_addon_purchase_source_status ON user_addon_purchases(source, status);

CREATE INDEX idx_orders_user_time ON orders(user_id, created_at);
CREATE INDEX idx_orders_source_status_time ON orders(source, payment_status, created_at);
CREATE INDEX idx_orders_source_provider_time ON orders(source, payment_provider, created_at);
CREATE INDEX idx_orders_paid_time ON orders(paid_at);

CREATE INDEX idx_payment_tx_order_status ON payment_transactions(order_id, status);
CREATE INDEX idx_payment_tx_source_provider_time ON payment_transactions(source, provider, created_at);
CREATE INDEX idx_payment_tx_provider_order ON payment_transactions(provider, provider_order_id);

CREATE INDEX idx_webhook_source_provider_status ON payment_webhook_events(source, provider, processing_status);
CREATE INDEX idx_webhook_time ON payment_webhook_events(created_at);

CREATE INDEX idx_storage_bucket_source_provider ON storage_buckets(source, provider, purpose);
CREATE INDEX idx_storage_file_user_time ON storage_files(user_id, created_at);
CREATE INDEX idx_storage_file_source_provider_bucket ON storage_files(source, provider, bucket_name);
CREATE INDEX idx_storage_file_status_time ON storage_files(storage_status, created_at);

CREATE INDEX idx_ai_task_user_time ON ai_tasks(user_id, created_at);
CREATE INDEX idx_ai_task_source_category_time ON ai_tasks(source, task_category, created_at);
CREATE INDEX idx_ai_task_status_time ON ai_tasks(status, created_at);

CREATE INDEX idx_ai_output_source_type_time ON ai_task_outputs(source, output_type, created_at);
CREATE INDEX idx_ai_output_user_time ON ai_task_outputs(user_id, created_at);

CREATE INDEX idx_detect_user_time ON ai_detection_reports(user_id, created_at);
CREATE INDEX idx_detect_source_target_time ON ai_detection_reports(source, target_type, created_at);
CREATE INDEX idx_detect_verdict_time ON ai_detection_reports(verdict, created_at);

CREATE INDEX idx_session_source_start ON analytics_sessions(source, started_at);
CREATE INDEX idx_session_user_start ON analytics_sessions(user_id, started_at);

CREATE INDEX idx_event_source_type_time ON analytics_events(source, event_type, created_at);
CREATE INDEX idx_event_user_time ON analytics_events(user_id, created_at);
CREATE INDEX idx_event_session_time ON analytics_events(session_id, created_at);
CREATE INDEX idx_event_related_task ON analytics_events(related_task_id);
CREATE INDEX idx_event_related_order ON analytics_events(related_order_id);

CREATE INDEX idx_admin_audit_admin_time ON admin_audit_logs(admin_user_id, created_at);
CREATE INDEX idx_admin_audit_target_time ON admin_audit_logs(target_type, target_id, created_at);
CREATE INDEX idx_admin_audit_action_time ON admin_audit_logs(action, created_at);

CREATE INDEX idx_ads_source_status_priority ON ads(source, status, priority);
CREATE INDEX idx_ads_source_platform_position ON ads(source, platform, position);
CREATE INDEX idx_ads_time_window ON ads(start_at, end_at);

CREATE INDEX idx_social_source_status_sort ON social_links(source, status, sort_order);
CREATE INDEX idx_release_source_platform_status ON app_releases(source, platform, status);
CREATE INDEX idx_release_source_platform_code ON app_releases(source, platform, version_code);

-- ============================================================================
-- 9) 初始化数据（套餐/价格/渠道/存储桶）
-- ============================================================================

-- 9.1 套餐配额（基于“订阅机制.md”，可由管理员在后台修改）
INSERT INTO subscription_plans (
  plan_code, display_name_cn, display_name_en, plan_level, is_active, admin_adjustable,
  monthly_document_limit, monthly_image_limit, monthly_video_limit, monthly_audio_limit,
  description_cn, description_en
)
SELECT
  'free', '免费版', 'Free', 0, TRUE, FALSE,
  120, 4, 1, 6,
  '免费基础套餐', 'Free baseline plan'
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plans WHERE plan_code = 'free'
);

INSERT INTO subscription_plans (
  plan_code, display_name_cn, display_name_en, plan_level, is_active, admin_adjustable,
  monthly_document_limit, monthly_image_limit, monthly_video_limit, monthly_audio_limit,
  description_cn, description_en
)
SELECT
  'pro', '专业版', 'Pro', 1, TRUE, TRUE,
  2000, 60, 10, 60,
  '专业套餐（额度可后台调整）', 'Pro plan (admin-adjustable quotas)'
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plans WHERE plan_code = 'pro'
);

INSERT INTO subscription_plans (
  plan_code, display_name_cn, display_name_en, plan_level, is_active, admin_adjustable,
  monthly_document_limit, monthly_image_limit, monthly_video_limit, monthly_audio_limit,
  description_cn, description_en
)
SELECT
  'enterprise', '企业版', 'Enterprise', 2, TRUE, TRUE,
  8000, 250, 25, 250,
  '企业套餐（额度可后台调整）', 'Enterprise plan (admin-adjustable quotas)'
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plans WHERE plan_code = 'enterprise'
);

-- 9.2 套餐价格（国内/国际）
INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_cn_free_monthly', 'cn', 'free', 'monthly', 'CNY', 0.00, 0.00, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_cn_free_monthly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_cn_free_yearly', 'cn', 'free', 'yearly', 'CNY', 0.00, 0.00, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_cn_free_yearly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_global_free_monthly', 'global', 'free', 'monthly', 'USD', 0.00, 0.00, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_global_free_monthly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_global_free_yearly', 'global', 'free', 'yearly', 'USD', 0.00, 0.00, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_global_free_yearly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_cn_pro_monthly', 'cn', 'pro', 'monthly', 'CNY', 39.90, NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_cn_pro_monthly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_cn_pro_yearly', 'cn', 'pro', 'yearly', 'CNY', 335.00, NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_cn_pro_yearly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_global_pro_monthly', 'global', 'pro', 'monthly', 'USD', 4.99, NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_global_pro_monthly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_global_pro_yearly', 'global', 'pro', 'yearly', 'USD', 41.90, NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_global_pro_yearly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_cn_ent_monthly', 'cn', 'enterprise', 'monthly', 'CNY', 129.90, NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_cn_ent_monthly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_cn_ent_yearly', 'cn', 'enterprise', 'yearly', 'CNY', 1091.00, NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_cn_ent_yearly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_global_ent_monthly', 'global', 'enterprise', 'monthly', 'USD', 14.99, NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_global_ent_monthly');

INSERT INTO plan_prices (id, source, plan_code, billing_period, currency, amount, original_amount, is_active)
SELECT 'price_global_ent_yearly', 'global', 'enterprise', 'yearly', 'USD', 125.90, NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE id = 'price_global_ent_yearly');

-- 9.3 加油包配额
INSERT INTO addon_packages (
  addon_code, display_name_cn, display_name_en, document_quota, image_quota, video_quota, audio_quota, sort_order, is_active
)
SELECT 'light', '轻量包', 'Light Pack', 1200, 25, 4, 25, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM addon_packages WHERE addon_code = 'light');

INSERT INTO addon_packages (
  addon_code, display_name_cn, display_name_en, document_quota, image_quota, video_quota, audio_quota, sort_order, is_active
)
SELECT 'standard', '标准包', 'Standard Pack', 3500, 70, 10, 70, 2, TRUE
WHERE NOT EXISTS (SELECT 1 FROM addon_packages WHERE addon_code = 'standard');

INSERT INTO addon_packages (
  addon_code, display_name_cn, display_name_en, document_quota, image_quota, video_quota, audio_quota, sort_order, is_active
)
SELECT 'premium', '高级包', 'Premium Pack', 8000, 180, 25, 180, 3, TRUE
WHERE NOT EXISTS (SELECT 1 FROM addon_packages WHERE addon_code = 'premium');

-- 9.4 加油包价格
INSERT INTO addon_package_prices (id, source, addon_code, currency, amount, is_active)
SELECT 'addon_price_cn_light', 'cn', 'light', 'CNY', 19.90, TRUE
WHERE NOT EXISTS (SELECT 1 FROM addon_package_prices WHERE id = 'addon_price_cn_light');

INSERT INTO addon_package_prices (id, source, addon_code, currency, amount, is_active)
SELECT 'addon_price_cn_standard', 'cn', 'standard', 'CNY', 49.90, TRUE
WHERE NOT EXISTS (SELECT 1 FROM addon_package_prices WHERE id = 'addon_price_cn_standard');

INSERT INTO addon_package_prices (id, source, addon_code, currency, amount, is_active)
SELECT 'addon_price_cn_premium', 'cn', 'premium', 'CNY', 99.90, TRUE
WHERE NOT EXISTS (SELECT 1 FROM addon_package_prices WHERE id = 'addon_price_cn_premium');

INSERT INTO addon_package_prices (id, source, addon_code, currency, amount, is_active)
SELECT 'addon_price_global_light', 'global', 'light', 'USD', 2.99, TRUE
WHERE NOT EXISTS (SELECT 1 FROM addon_package_prices WHERE id = 'addon_price_global_light');

INSERT INTO addon_package_prices (id, source, addon_code, currency, amount, is_active)
SELECT 'addon_price_global_standard', 'global', 'standard', 'USD', 6.99, TRUE
WHERE NOT EXISTS (SELECT 1 FROM addon_package_prices WHERE id = 'addon_price_global_standard');

INSERT INTO addon_package_prices (id, source, addon_code, currency, amount, is_active)
SELECT 'addon_price_global_premium', 'global', 'premium', 'USD', 13.99, TRUE
WHERE NOT EXISTS (SELECT 1 FROM addon_package_prices WHERE id = 'addon_price_global_premium');

-- 9.5 认证渠道配置（国内：微信+邮箱验证码；国际：Google+Supabase Email）
INSERT INTO auth_provider_configs (id, source, provider, display_name, is_enabled, sort_order)
SELECT 'auth_cn_wechat', 'cn', 'wechat', '微信登录', TRUE, 1
WHERE NOT EXISTS (SELECT 1 FROM auth_provider_configs WHERE id = 'auth_cn_wechat');

INSERT INTO auth_provider_configs (id, source, provider, display_name, is_enabled, sort_order)
SELECT 'auth_cn_email_code', 'cn', 'email_code', '邮箱验证码', TRUE, 2
WHERE NOT EXISTS (SELECT 1 FROM auth_provider_configs WHERE id = 'auth_cn_email_code');

INSERT INTO auth_provider_configs (id, source, provider, display_name, is_enabled, sort_order)
SELECT 'auth_global_google', 'global', 'google', 'Google', TRUE, 1
WHERE NOT EXISTS (SELECT 1 FROM auth_provider_configs WHERE id = 'auth_global_google');

INSERT INTO auth_provider_configs (id, source, provider, display_name, is_enabled, sort_order)
SELECT 'auth_global_supabase_email', 'global', 'supabase_email', 'Supabase Email Auth', TRUE, 2
WHERE NOT EXISTS (SELECT 1 FROM auth_provider_configs WHERE id = 'auth_global_supabase_email');

-- 9.6 支付渠道配置（国内：支付宝/微信支付；国际：Stripe/PayPal）
INSERT INTO payment_provider_configs (id, source, provider, display_name, supports_subscription, supports_refund, is_enabled, sort_order)
SELECT 'pay_cn_alipay', 'cn', 'alipay', '支付宝', TRUE, TRUE, TRUE, 1
WHERE NOT EXISTS (SELECT 1 FROM payment_provider_configs WHERE id = 'pay_cn_alipay');

INSERT INTO payment_provider_configs (id, source, provider, display_name, supports_subscription, supports_refund, is_enabled, sort_order)
SELECT 'pay_cn_wechat', 'cn', 'wechat_pay', '微信支付', TRUE, TRUE, TRUE, 2
WHERE NOT EXISTS (SELECT 1 FROM payment_provider_configs WHERE id = 'pay_cn_wechat');

INSERT INTO payment_provider_configs (id, source, provider, display_name, supports_subscription, supports_refund, is_enabled, sort_order)
SELECT 'pay_global_stripe', 'global', 'stripe', 'Stripe', TRUE, TRUE, TRUE, 1
WHERE NOT EXISTS (SELECT 1 FROM payment_provider_configs WHERE id = 'pay_global_stripe');

INSERT INTO payment_provider_configs (id, source, provider, display_name, supports_subscription, supports_refund, is_enabled, sort_order)
SELECT 'pay_global_paypal', 'global', 'paypal', 'PayPal', TRUE, TRUE, TRUE, 2
WHERE NOT EXISTS (SELECT 1 FROM payment_provider_configs WHERE id = 'pay_global_paypal');

-- 9.7 存储桶配置（文件实体走 CloudBase 云存储 / Supabase Storage）
INSERT INTO storage_buckets (id, source, provider, bucket_name, purpose, is_public, is_active)
SELECT 'bucket_cn_generated', 'cn', 'cloudbase', 'generated-outputs', 'generated_output', FALSE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage_buckets WHERE id = 'bucket_cn_generated');

INSERT INTO storage_buckets (id, source, provider, bucket_name, purpose, is_public, is_active)
SELECT 'bucket_cn_avatar', 'cn', 'cloudbase', 'user-avatars', 'avatar', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage_buckets WHERE id = 'bucket_cn_avatar');

INSERT INTO storage_buckets (id, source, provider, bucket_name, purpose, is_public, is_active)
SELECT 'bucket_cn_ads', 'cn', 'cloudbase', 'ads-media', 'ads_media', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage_buckets WHERE id = 'bucket_cn_ads');

INSERT INTO storage_buckets (id, source, provider, bucket_name, purpose, is_public, is_active)
SELECT 'bucket_cn_releases', 'cn', 'cloudbase', 'release-packages', 'release_package', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage_buckets WHERE id = 'bucket_cn_releases');

INSERT INTO storage_buckets (id, source, provider, bucket_name, purpose, is_public, is_active)
SELECT 'bucket_global_generated', 'global', 'supabase', 'generated-outputs', 'generated_output', FALSE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage_buckets WHERE id = 'bucket_global_generated');

INSERT INTO storage_buckets (id, source, provider, bucket_name, purpose, is_public, is_active)
SELECT 'bucket_global_avatar', 'global', 'supabase', 'user-avatars', 'avatar', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage_buckets WHERE id = 'bucket_global_avatar');

INSERT INTO storage_buckets (id, source, provider, bucket_name, purpose, is_public, is_active)
SELECT 'bucket_global_ads', 'global', 'supabase', 'ads-media', 'ads_media', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage_buckets WHERE id = 'bucket_global_ads');

INSERT INTO storage_buckets (id, source, provider, bucket_name, purpose, is_public, is_active)
SELECT 'bucket_global_releases', 'global', 'supabase', 'release-packages', 'release_package', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage_buckets WHERE id = 'bucket_global_releases');

-- ============================================================================
-- 完成
-- 后续建议：
-- 1) 应用层统一维护 updated_at
-- 2) 后台修改专业版/企业版额度：直接更新 subscription_plans 即可
-- 3) 用户级额度微调：更新 user_quota_balances，并写入 user_quota_change_logs
-- ============================================================================
