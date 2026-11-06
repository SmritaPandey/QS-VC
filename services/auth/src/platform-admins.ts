/**
 * Platform administrators: these accounts get the `admin` role (full access to every feature).
 * In cloud/development, defaults to DEFAULT_ADMIN_EMAILS if unset.
 * In on-premises mode (QSVC_DEPLOYMENT=onprem), DEFAULT_ADMIN_EMAILS is disabled,
 * and administrators MUST be explicitly provided via QSVC_ADMIN_EMAILS.
 */
const DEFAULT_ADMIN_EMAILS = ['services@madylabs.xyz', 'contact@neurqai.com', 'smrita.official@gmail.com'];

export function platformAdminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
    const configured = env.QSVC_ADMIN_EMAILS?.split(',').map(value => value.trim().toLowerCase()).filter(Boolean) ?? [];
    if (env.QSVC_DEPLOYMENT === 'onprem') {
        return new Set(configured);
    }
    return new Set([...DEFAULT_ADMIN_EMAILS, ...configured]);
}

export function isPlatformAdmin(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
    return platformAdminEmails(env).has(email.trim().toLowerCase());
}

/** The role an account should carry: admin for listed emails, otherwise whatever is stored. */
export function effectiveRole(email: string, storedRole: string, env: NodeJS.ProcessEnv = process.env): string {
    return isPlatformAdmin(email, env) ? 'admin' : storedRole;
}

/** Asserts that on-premises deployments have at least one explicit administrator configured. */
export function assertPlatformAdminConfig(env: NodeJS.ProcessEnv = process.env): void {
    if (env.QSVC_DEPLOYMENT === 'onprem') {
        const admins = platformAdminEmails(env);
        if (admins.size === 0) {
            throw new Error('QSVC_DEPLOYMENT=onprem requires QSVC_ADMIN_EMAILS to be set with at least one administrator email.');
        }
    }
}

