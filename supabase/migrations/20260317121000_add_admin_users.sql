CREATE TABLE IF NOT EXISTS public.admin_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    last_login_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'update_updated_at_column'
          AND n.nspname = 'public'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_admin_users_updated_at'
          AND tgrelid = 'public.admin_users'::regclass
    ) THEN
        CREATE TRIGGER update_admin_users_updated_at
            BEFORE UPDATE ON public.admin_users
            FOR EACH ROW
            EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'dev') THEN
        EXECUTE '
            CREATE TABLE IF NOT EXISTS dev.admin_users (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                username text NOT NULL UNIQUE,
                password_hash text NOT NULL,
                last_login_at timestamptz,
                created_at timestamptz DEFAULT now(),
                updated_at timestamptz DEFAULT now()
            )
        ';

        IF EXISTS (
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.proname = 'update_updated_at_column'
              AND n.nspname = 'dev'
        ) AND NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = 'update_admin_users_updated_at'
              AND tgrelid = 'dev.admin_users'::regclass
        ) THEN
            EXECUTE '
                CREATE TRIGGER update_admin_users_updated_at
                BEFORE UPDATE ON dev.admin_users
                FOR EACH ROW
                EXECUTE FUNCTION dev.update_updated_at_column()
            ';
        END IF;
    END IF;
END;
$$;
