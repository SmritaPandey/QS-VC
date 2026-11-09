# Personal Google and Microsoft sign-in

Apply migration 027 with the usual migration account before deploying the new auth service. Run `db/verify-access.sql` against staging to check identity uniqueness and tenant isolation. The web and desktop clients show each button when its credentials are configured on the auth service.

## Provider setup

1. Set `QSVC_SSO_AUTH_URL` to the public auth origin and `QSVC_SSO_WEB_URL` to the browser app origin. Use HTTPS in production. Electron workspaces must serve the auth endpoints on the workspace origin. The personal providers connect directly to Google and Microsoft and can run independently of Keycloak.
2. In Google Cloud, create a **Web application** OAuth client with the exact redirect URI `<auth origin>/api/auth/sso/personal/callback/google`. Set `QSVC_GOOGLE_CLIENT_ID` and `QSVC_GOOGLE_CLIENT_SECRET` on the auth service. Configure the consent screen for the intended audience.
3. In Microsoft Entra, register an app supporting **personal Microsoft accounts**, add the **Web** redirect URI `<auth origin>/api/auth/sso/personal/callback/microsoft`, and create a client secret. Set `QSVC_MICROSOFT_CLIENT_ID` and `QSVC_MICROSOFT_CLIENT_SECRET` on the auth service. Managed work or school identities continue through the organisation SSO setup.
4. Set `QSVC_EMAIL_FROM` to a verified Resend sender and `QSVC_EMAIL_API_KEY` on the auth service. New Microsoft accounts verify their QS-VC email with a one-time code. Google accounts can use an address Google verifies and is authoritative for, such as Gmail or a managed Workspace mailbox. Other addresses use the same one-time email check. Existing linked identities can sign in without sending an email.
5. Restart auth and test each configured provider with one new account and one existing linked account. Workspaces configured to require Enterprise access terms use organisation-controlled provisioning, so personal sign-in options are hidden there.

New users enter a mobile number with country code. Existing users can link Google or Microsoft from **Your meetings → Account menu → Sign-in settings** while signed in. The provider signs in to the same QS-VC account and plan after linking. If someone tries to create a new account with an existing email, the flow asks them to sign in to the existing account and link there. Provider tokens and client secrets stay off the web and desktop renderers.

- [Google OpenID Connect configuration](https://developers.google.com/identity/openid-connect/openid-connect)
- [Microsoft identity platform registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
