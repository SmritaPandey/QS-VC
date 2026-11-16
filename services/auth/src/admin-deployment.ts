export type AdminDeploymentMode = 'hosted-online' | 'onprem-intranet' | 'onprem-online';

function httpsOrigin(value: string | undefined): string | null {
    if (!value || !/^https:\/\/[^/\s\\?#]+\/?$/.test(value) || !URL.canParse(value)) return null;
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    // Only the configured origin is sent to the dashboard. It is never fetched by this service.
    return url.origin;
}

export function adminDeployment(env: NodeJS.ProcessEnv = process.env) {
    const onPremises = env.QSVC_DEPLOYMENT === 'onprem';
    const mode: AdminDeploymentMode = !onPremises ? 'hosted-online'
        : env.QSVC_ONPREM_EXPOSURE === 'public' ? 'onprem-online' : 'onprem-intranet';
    return {
        mode,
        publicMeetingOrigin: mode === 'onprem-online' ? httpsOrigin(env.QSVC_PUBLIC_MEETING_ORIGIN) : null,
        ssoConfigured: env.QSVC_SSO_ENABLED === 'true' && Boolean(env.QSVC_KEYCLOAK_ISSUER &&
            env.QSVC_KEYCLOAK_CLIENT_SECRET && env.QSVC_SSO_AUTH_URL && env.QSVC_SSO_WEB_URL),
        localAiEnabled: onPremises && env.QSVC_AI_GATEWAY_ENABLED === 'true',
        canIssueLicense: !onPremises && Boolean(env.QSVC_ONPREM_LICENSE_KEY_FILE?.trim()),
    };
}
