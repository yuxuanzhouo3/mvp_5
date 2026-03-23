-- ============================================================================
-- MVP5 项目名称配置（CloudBase SQL / Supabase SQL Editor 通用）
-- 说明：
-- 1) 用于后台“额度管理”中的项目名称一键更改
-- 2) 前台与后台统一读取 app_display_name
-- 3) 仅使用跨库兼容语法，不依赖 PostgreSQL 专属特性
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  setting_value VARCHAR(512) NOT NULL,
  setting_desc VARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_settings (
  setting_key,
  setting_value,
  setting_desc,
  updated_at
)
SELECT
  'app_display_name',
  'MornStudio',
  'Project display name for frontend/admin titles',
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings WHERE setting_key = 'app_display_name'
);
