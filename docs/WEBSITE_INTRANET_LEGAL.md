# Website intranet entry and legal drafts

Added 3 November 2026.

- `/intranet`: website navigation/footer entry for an administrator-supplied HTTPS workspace. Validates protocol and excludes credentials, query strings and fragments. Shows the destination for an explicit second click; no credentials or public login token are forwarded and no endpoint is probed. This is a navigation entry, not VPN provisioning, SSO federation or cloud/local synchronisation.
- Office users need the organisation network. Travelling users need an approved VPN and reachable office service. Offline users must use the local workspace directly; the public website cannot serve as their offline entry dependency.
- `/terms` and `/privacy`: review drafts linked in the footer, with actual current disabled-payment/recording status and transient collaboration limitations.

## Evidence and remaining configuration

Architecture reference: `architecture/14_deployment_modes_comparison.md` describes deployment targets, not proof of deployed features. `docs/DATABASE_RESILIENCE.md` explicitly describes independent databases and organisation VPN access. Example URLs such as meet.example.com and meet.qsvc.io are not adopted as a customer's intranet endpoint.

The user identified Neurq AI Private Limited as the owner of QS-VC on 3 November 2026; the footer and legal pages reflect that instruction. No confirmed organisation HTTPS workspace URL, registered postal address or privacy contact was found in the reviewed architecture/docs. Supply those before finalising a deployment-specific shortcut and adopting the policies. Also confirm actual processors, processing countries, retention/deletion schedules, child-access policy, refunds/renewals and governing law; obtain legal review. Do not claim regulatory compliance merely because policy pages exist.

Legal reference checked: Ministry of Electronics and Information Technology, Digital Personal Data Protection Rules 2025: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa . Applicability and phased commencement require review for the actual operator/deployment.

Pending live verification: HTTPS certificate, VPN routing/private DNS, local sign-in, camera/mic permissions and two-device meetings. No network infrastructure was provisioned by this website change.

## Approved-enterprise portal (3 November update)

`/intranet` now checks `/api/auth/enterprise` using the existing revocable session. Unapproved/signed-out users see a guided sample preview; approved users see their administrator-configured workspace and Windows download availability. Verification failures do not grant access.

Auth service configuration (server only): `ENTERPRISE_ACCESS_JSON` is an array of `{ "tenantId": "...", "userIds": ["..."], "workspaceUrl": "https://..." }`. Approve explicit users as well as tenants because current self-registration can select a tenant slug. No approvals are configured by this change.

`ENTERPRISE_WINDOWS_INSTALLER` must be an absolute path to a reviewed Windows `.exe` outside public/static directories. `/api/auth/enterprise/windows` rechecks session and approval before streaming it. No artifact is currently supplied. Restart/redeploy auth after configuration. Installer approval is not workspace authentication, a VPN, or licence enforcement against redistributed copies.

Desktop release remains pending: Electron dependencies/build tools and logo assets are absent locally; existing desktop scaffold defaults to localhost, lacks an organisation setup screen, automatically grants permissions, and requires a security/update review before distribution. No executable has been built, signed, deployed or Windows-tested. Do not configure the download path until those release tasks are complete.

`/signup` is an account-request page, not public enterprise enrolment. Google, Microsoft and organisation SSO/SAML are disabled placeholders on it and `/login`. No provider authentication is claimed.
