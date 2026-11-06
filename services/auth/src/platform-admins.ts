/**
 * Platform administrators: these accounts get the `admin` role (full access to every feature).
 * Add extra platform administrators with QSVC_ADMIN_EMAILS="a@x.com,b@y.com" in the environment.
 * The role is only ever assigned by the server at sign-up/sign-in, never accepted from the browser.
 */
const DEFAULT_ADMIN_EMAILS = ['services@madylabs.xyz', 'contact@neurqai.com', 'smrita.official@gmail.com'];

export function platformAdminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
    const configured = env.QSVC_ADMIN_EMAILS?.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    return new Set([...DEFAULT_ADMIN_EMAILS, ...(configured ?? [])]);
}

export function isPlatformAdmin(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
    return platformAdminEmails(env).has(email.trim().toLowerCase());
}

/** The role an account should carry: admin for listed emails, otherwise whatever is stored. */
export function effectiveRole(email: string, storedRole: string, env: NodeJS.ProcessEnv = process.env): string {
    return isPlatformAdmin(email, env) ? 'admin' : storedRole;
}
