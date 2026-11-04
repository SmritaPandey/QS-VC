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

`/intranet` checks `/api/auth/enterprise` using the existing revocable session. Unapproved/signed-out users see a guided sample preview; approved users see their administrator-configured workspace and staged Windows, Mac Apple silicon, and Mac Intel ZIP availability. Verification failures do not grant access. The page uses explicit platform routes and falls back to the earlier `/download/:platform` route during a rolling release. A 404 after both routes indicates that the deployed auth service is missing the download route; a 503 means its ZIP is not staged or could not be streamed.

Auth service configuration (server only): `ENTERPRISE_ACCESS_JSON` is an array of `{ "tenantId": "...", "userIds": ["..."], "workspaceUrl": "https://..." }`. Approve explicit users as well as tenants because current self-registration can select a tenant slug. No approvals are configured by this change.

`ENTERPRISE_WINDOWS_INSTALLER`, `ENTERPRISE_MACOS_ARM64_INSTALLER`, and `ENTERPRISE_MACOS_X64_INSTALLER` must point to reviewed ZIP files outside public/static directories. The auth service rechecks session and active enterprise access before streaming each artifact. The Linux deployment mounts `deploy/aws/installers` read-only and verifies all three ZIPs and their checksums before release. Restart/redeploy auth after configuration. Installer approval is not workspace authentication, a VPN, or licence enforcement against redistributed copies.

Desktop builds and packages are present in the local installer staging directory, but their production signing, deployed availability and real-device installation status must be checked against the current release before being claimed. The desktop app can report an aggregate activation after enterprise sign-in (platform, architecture, version and date only; no account or device ID). Counts are client-reported and may repeat after local app data is cleared or the app is reinstalled. See the privacy draft for the separate platform-admin ledger and retention decisions still required.

`/signup` is an account-request page, not public enterprise enrolment. Google, Microsoft and organisation SSO/SAML are disabled placeholders on it and `/login`. No provider authentication is claimed.
