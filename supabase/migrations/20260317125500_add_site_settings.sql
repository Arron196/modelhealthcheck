CREATE TABLE IF NOT EXISTS public.site_settings (
  singleton_key text PRIMARY KEY DEFAULT 'global' CHECK (singleton_key = 'global'),
  site_name text NOT NULL DEFAULT '模型中转状态检测',
  site_description text NOT NULL DEFAULT '实时检测 OpenAI / Gemini / Anthropic 对话接口的可用性与延迟',
  hero_badge text NOT NULL DEFAULT 'System Status',
  hero_title_primary text NOT NULL DEFAULT '模型中转',
  hero_title_secondary text NOT NULL DEFAULT '状态检测',
  hero_description text NOT NULL DEFAULT '实时追踪各大 AI 模型对话接口的可用性、延迟与官方服务状态。\nAdvanced performance metrics for next-gen intelligence.',
  footer_brand text NOT NULL DEFAULT '模型中转状态检测',
  admin_console_title text NOT NULL DEFAULT '站点管理后台',
  admin_console_description text NOT NULL DEFAULT '针对当前监控站点的数据源、公告和全局站点设置进行统一维护。',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read site settings" ON public.site_settings;
CREATE POLICY "Allow public read site settings"
  ON public.site_settings
  FOR SELECT
  TO public
  USING (true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS update_site_settings_updated_at ON public.site_settings;
    CREATE TRIGGER update_site_settings_updated_at
      BEFORE UPDATE ON public.site_settings
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

INSERT INTO public.site_settings (singleton_key)
VALUES ('global')
ON CONFLICT (singleton_key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'dev') THEN
    EXECUTE $sql$
      CREATE TABLE IF NOT EXISTS dev.site_settings (
        singleton_key text PRIMARY KEY DEFAULT 'global' CHECK (singleton_key = 'global'),
        site_name text NOT NULL DEFAULT '模型中转状态检测',
        site_description text NOT NULL DEFAULT '实时检测 OpenAI / Gemini / Anthropic 对话接口的可用性与延迟',
        hero_badge text NOT NULL DEFAULT 'System Status',
        hero_title_primary text NOT NULL DEFAULT '模型中转',
        hero_title_secondary text NOT NULL DEFAULT '状态检测',
        hero_description text NOT NULL DEFAULT '实时追踪各大 AI 模型对话接口的可用性、延迟与官方服务状态。\nAdvanced performance metrics for next-gen intelligence.',
        footer_brand text NOT NULL DEFAULT '模型中转状态检测',
        admin_console_title text NOT NULL DEFAULT '站点管理后台',
        admin_console_description text NOT NULL DEFAULT '针对当前监控站点的数据源、公告和全局站点设置进行统一维护。',
        created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
        updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
      );
    $sql$;

    EXECUTE 'ALTER TABLE dev.site_settings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Allow public read site settings" ON dev.site_settings';
    EXECUTE $sql$
      CREATE POLICY "Allow public read site settings"
      ON dev.site_settings
      FOR SELECT
      TO public
      USING (true)
    $sql$;

    IF EXISTS (
      SELECT 1
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name = 'update_updated_at_column'
    ) THEN
      EXECUTE 'DROP TRIGGER IF EXISTS update_site_settings_updated_at ON dev.site_settings';
      EXECUTE 'CREATE TRIGGER update_site_settings_updated_at BEFORE UPDATE ON dev.site_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
    END IF;

    EXECUTE 'INSERT INTO dev.site_settings (singleton_key) VALUES (''global'') ON CONFLICT (singleton_key) DO NOTHING';
  END IF;
END $$;
