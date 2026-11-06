ALTER TABLE public.platform_installer_downloads
    DROP CONSTRAINT platform_installer_downloads_platform_check,
    ADD CONSTRAINT platform_installer_downloads_platform_check
        CHECK (platform IN ('windows', 'macos-arm64', 'macos-x64', 'linux-x64'));

ALTER TABLE public.platform_desktop_activations
    DROP CONSTRAINT platform_desktop_activations_platform_check,
    ADD CONSTRAINT platform_desktop_activations_platform_check
        CHECK (platform IN ('win32', 'darwin', 'linux'));

-- Add Linux to the platform breakdown while preserving the existing analytics query.
DO $$
DECLARE
    function_sql text := pg_get_functiondef('public.qsvc_platform_admin_analytics(integer)'::regprocedure);
    previous_platforms text := $old$VALUES ('windows'), ('macos-arm64'), ('macos-x64')$old$;
    current_platforms text := $new$VALUES ('windows'), ('macos-arm64'), ('macos-x64'), ('linux-x64')$new$;
BEGIN
    IF position(current_platforms IN function_sql) = 0 THEN
        IF position(previous_platforms IN function_sql) = 0 THEN
            RAISE EXCEPTION 'Expected platform list was not found in qsvc_platform_admin_analytics';
        END IF;
        EXECUTE replace(function_sql, previous_platforms, current_platforms);
    END IF;
END $$;
