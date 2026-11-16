import { expect, it } from 'vitest';
import { adminDeployment } from './admin-deployment';

it('maps existing public and on-prem deployments without inferring exposure from the URL', () => {
    expect(adminDeployment({ QSVC_ONPREM_EXPOSURE: 'public', QSVC_PUBLIC_MEETING_ORIGIN: 'https://meeting.example.test' }))
        .toEqual({ mode: 'hosted-online', publicMeetingOrigin: null, ssoConfigured: false, localAiEnabled: false, canIssueLicense: false });
    expect(adminDeployment({ QSVC_DEPLOYMENT: 'onprem', QSVC_PUBLIC_MEETING_ORIGIN: 'https://meeting.example.test',
        QSVC_ONPREM_LICENSE_KEY_FILE: '/private/key.pem', QSVC_AI_GATEWAY_ENABLED: 'true' }))
        .toEqual({ mode: 'onprem-intranet', publicMeetingOrigin: null, ssoConfigured: false, localAiEnabled: true, canIssueLicense: false });
});

it('publishes a configured HTTPS meeting origin and capability flags without credentials', () => {
    expect(adminDeployment({
        QSVC_DEPLOYMENT: 'onprem', QSVC_ONPREM_EXPOSURE: 'public', QSVC_PUBLIC_MEETING_ORIGIN: 'https://meeting.example.test/',
        QSVC_SSO_ENABLED: 'true', QSVC_KEYCLOAK_ISSUER: 'https://id.example.test/realms/qs',
        QSVC_SSO_AUTH_URL: 'https://meeting.example.test', QSVC_SSO_WEB_URL: 'https://meeting.example.test',
        QSVC_KEYCLOAK_CLIENT_SECRET: 'secret',
    })).toEqual({
        mode: 'onprem-online', publicMeetingOrigin: 'https://meeting.example.test',
        ssoConfigured: true, localAiEnabled: false, canIssueLicense: false,
    });
    expect(adminDeployment({ QSVC_ONPREM_LICENSE_KEY_FILE: '/private/key.pem' }).canIssueLicense).toBe(true);
});

it.each([undefined, 'http://meeting.example.test', 'https://operator:secret@meeting.example.test',
    'https://meeting.example.test/room', 'https://meeting.example.test/./', 'https://example.test?query=1',
    'https://example.test/#fragment', 'https:///example.test'])('marks an unusable public origin incomplete (%s)', publicMeetingOrigin => {
    expect(adminDeployment({ QSVC_DEPLOYMENT: 'onprem', QSVC_ONPREM_EXPOSURE: 'public', QSVC_PUBLIC_MEETING_ORIGIN: publicMeetingOrigin }))
        .toMatchObject({ mode: 'onprem-online', publicMeetingOrigin: null });
});
