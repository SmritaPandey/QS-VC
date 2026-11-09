# Enterprise single sign-on

## Auth audit

| Check | Before this change |
| --- | --- |
| ✅ Password and registration | Passwords used bcrypt. Public registration was restricted to the personal tenant. |
| ✅ Session issuance | Auth issued expiring JWTs. Protected routes checked the active database session, user and tenant. |
| ✅ Enterprise access | `enterprise-access.ts` managed approval and time-limited access. Platform administrators came from a separate email allowlist. |
| ✅ Plan features | The server computed entitlement from the account and tenant. Enterprise approval and the optional intranet access term were separate checks. |
| ❌ Enterprise identity | No verified-domain discovery, identity-provider binding, SAML/OIDC login, or password enforcement by domain. |
| ❌ Auth database role scope | The legacy auth role could read users across tenants for unauthenticated email lookup. The new connection and identity tables force RLS and tenant-match references. |
| ❌ Desktop meeting credential | The existing desktop handoff put the session token into meeting page storage. The renderer now receives a placeholder and Electron supplies the credential only to same-origin API requests from its meeting frame. |

## Deploy

1. Apply all outstanding migrations using `npm run db:migrate` with the migration database URL. SSO is migration 026 because 019 already tracks meeting invitations. Run `psql <migration-connection> -f db/verify-access.sql` against a staging database. Production auth should connect as `qs_auth_app`, which inherits the SSO grants through `qsvc_auth_service`.
2. Set `QSVC_SSO_ENABLED=true`, `QSVC_SSO_WEB_URL` to the browser app origin, `QSVC_SSO_AUTH_URL` to the public auth origin, and `KEYCLOAK_PUBLIC_URL` to a dedicated HTTPS login origin. Desktop workspaces must route the auth API and SSO callback through their workspace origin. Use origin URLs without trailing slashes. Set `QSVC_KEYCLOAK_ISSUER` to the Keycloak login origin followed by `/realms/qsvc`. AWS uses the loopback-published Keycloak port for server calls and other profiles use Compose DNS.
3. Set independent database and OIDC client secrets from your secret store. The Keycloak database is separate from the application database. The realm import creates the confidential login client and a service account limited to identity-provider management with the `kc-admin-api` audience scope. Set bootstrap admin credentials on first start, then remove them from the service environment once the operator account is set up. Realm import skips an existing realm, so rotate existing realm client secrets through Keycloak as well as in deployment secrets.
4. Run `docker compose -f <profile> --profile sso up -d --wait keycloak keycloak-db`. Rebuild and restart QS-VC auth, web and desktop using the normal release process. The Keycloak listener is published on loopback. Terminate TLS at a reverse proxy and forward the realm URLs and required Keycloak static resources. Keep the Admin REST API, admin console, management port and PostgreSQL private. Use the Keycloak internal URL for API calls. Strip authorization headers, cookies and URL query values from proxy logs. Limit Keycloak outbound traffic to approved provider hosts and block infrastructure metadata addresses.
5. Add the approved upstream hostnames to `QSVC_SSO_IDP_HOSTS`. For OIDC, configure the exact issuer, authorization, token and JWKS URLs. QS-VC configures a confidential upstream client using HTTP Basic client authentication and S256 PKCE. Providers must return the account email in the signed ID token. SAML requires signed assertions, an HTTPS POST binding endpoint and an email-format NameID or standard SAML email attribute. Restrict upstream access to the intended organisation users.
6. Open **Your meetings → Account menu → Sign-in settings** as an administrator of an active Enterprise tenant. Add the domain and verify the displayed DNS TXT value. Save the provider and use the displayed callback URL or SAML SP metadata to complete the upstream configuration. Test the connection with a real organisation account before requiring SSO.
7. Invite existing accounts to link through **Sign-in settings** while password login is still enabled. SSO never merges accounts based on email alone. A successful SSO for a new identity creates a member in the verified Enterprise tenant. Existing intranet deployments that require per-user Enterprise access terms must still assign the term before the new account can receive a QS-VC session. Allowlisted platform administrators retain password access.

When changing an identity provider issuer or ownership, schedule the migration with the platform operator. Existing provider changes are intentionally operator-managed because existing identities are bound to the broker and tenant. Back up and restore Keycloak PostgreSQL alongside the application database. For offline distribution, the optional `QSVC_PACKAGE_SSO=true` release bundle includes the verified Keycloak image tag. After loading the signed or checksum-verified bundle, use a local Compose override for the archived tag if the offline engine cannot resolve the registry digest.

## DigiLocker

Enable `QSVC_DIGILOCKER_ENABLED` only after your requester integration is approved and the provider endpoints, scope and client credentials are set. Register `/api/auth/sso/digilocker/callback` on the public auth origin. Users start consent from **Sign-in settings** while signed in. QS-VC persists the DigiLocker ID and consent time on that account and does not persist provider tokens or document or profile details. DigiLocker consent does not grant Enterprise membership or bypass the organisation's identity provider.

## References

- [Keycloak Server Administration Guide](https://www.keycloak.org/docs/26.8.1/server_admin/)
- [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/)
- [openid-client authorization code grant](https://github.com/panva/openid-client/blob/main/docs/functions/authorizationCodeGrant.md)
- [DigiLocker requester onboarding](https://www.digilocker.gov.in/web/implementation-model)
