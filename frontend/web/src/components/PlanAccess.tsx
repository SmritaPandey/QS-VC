import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEntitlements } from '../lib/entitlements';
import { useSession } from '../lib/use-session';
import type { Plan } from '../../../../shared/entitlements.cjs';

export function CrownBadge({ plan }: { plan: Plan }) {
    if (plan === 'guest') return null;
    const label = plan === 'starter' || plan === 'starter_trial' ? 'Starter' : plan === 'pro' ? 'Pro' : 'Quantum-Premise';
    const tone = plan === 'starter' || plan === 'starter_trial' ? 'silver' : plan === 'pro' ? 'gold' : 'violet';
    return <span className={`plan-crown plan-crown--${tone}`} title={`${label} plan`} aria-label={`${label} plan`}><span className="mi" aria-hidden="true">workspace_premium</span></span>;
}

export function TrialChip() {
    const { plan, trialEndsAt } = useEntitlements();
    const [, tick] = useState(0);
    useEffect(() => {
        const timer = window.setInterval(() => tick(value => value + 1), 60_000);
        return () => window.clearInterval(timer);
    }, []);
    if (plan !== 'starter_trial' || !trialEndsAt) return null;
    const days = Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000));
    return <span className="trial-chip" aria-label={`Starter trial, ${days} days left`}>Starter trial · {days} {days === 1 ? 'day' : 'days'} left</span>;
}

export function UpgradePrompt({ requiredPlan, onClose, blocking = false }: { requiredPlan: Plan; onClose?: () => void; blocking?: boolean }) {
    const entitlements = useEntitlements();
    const session = useSession();
    const navigate = useNavigate();
    const dialogRef = useRef<HTMLElement>(null);
    const guest = session.status !== 'authenticated';
    const trialEnded = entitlements.status === 'trial_expired';
    const enterprisePending = entitlements.status === 'enterprise_pending';
    const enterpriseRejected = entitlements.status === 'enterprise_rejected';
    const requiredLabel = requiredPlan === 'enterprise' ? 'Quantum-Premise' : requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1);
    useEffect(() => { dialogRef.current?.focus(); }, []);
    let actions: ReactNode;
    if (enterprisePending || enterpriseRejected) {
        actions = <div className="upgrade-actions"><Link to="/app">Back to meetings</Link></div>;
    } else if (trialEnded) {
        actions = <div className="upgrade-plans">
            <Link to="/pricing#plan-starter" className="upgrade-plan" onClick={onClose}><strong>Starter</strong><span>Core tools for your team</span><b>View plan</b></Link>
            <Link to="/pricing#plan-pro" className="upgrade-plan upgrade-plan--pro" onClick={onClose}><CrownBadge plan="pro" /><strong>Pro</strong><span>Advanced capabilities</span><b>View plan</b></Link>
        </div>;
    } else if (requiredPlan === 'pro' && !guest) {
        actions = <div className="upgrade-plans">
            <Link to="/pricing#plan-pro" className="upgrade-plan upgrade-plan--pro" onClick={onClose}><CrownBadge plan="pro" /><strong>Pro</strong><span>Advanced capabilities</span><b>Upgrade to Pro</b></Link>
            <Link to="/pricing" className="upgrade-compare" onClick={onClose}>Compare plans</Link>
        </div>;
    } else {
        actions = <div className="upgrade-actions">
            <button className="public-primary" type="button" onClick={() => navigate('/pricing')}>{guest ? 'Choose a plan' : `Upgrade to ${requiredLabel}`}</button>
            {guest && <button className="upgrade-later" type="button" onClick={onClose}>Maybe later</button>}
        </div>;
    }
    return <div className="upgrade-backdrop" role="presentation" onMouseDown={event => { if (!blocking && event.target === event.currentTarget) onClose?.(); }}>
        <section ref={dialogRef} tabIndex={-1} className="upgrade-dialog" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" aria-describedby="upgrade-copy" onKeyDown={event => {
            if (event.key === 'Escape' && !blocking) onClose?.();
            if (event.key === 'Tab') {
                const items = event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled])');
                if (!items.length) return;
                const first = items[0], last = items[items.length - 1];
                if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        }}>
            <button className="upgrade-close" type="button" aria-label="Close upgrade prompt" onClick={onClose} disabled={blocking}>×</button>
            <span className="mi upgrade-icon" aria-hidden="true">{trialEnded ? 'hourglass_disabled' : enterprisePending || enterpriseRejected ? 'domain' : 'lock'}</span>
            <h2 id="upgrade-title">{trialEnded ? 'Your Starter trial has ended' : enterprisePending ? 'Quantum-Premise access pending' : enterpriseRejected ? 'Quantum-Premise access not approved' : guest ? 'Unlock this feature' : `Available on ${requiredLabel}`}</h2>
            <p id="upgrade-copy">{trialEnded ? 'Choose a plan to keep using your meetings workspace.' : enterprisePending ? 'Your Quantum-Premise request is waiting for administrator approval.' : enterpriseRejected ? 'Contact your organisation administrator to discuss Quantum-Premise access.' : 'Choose a plan to access this feature.'}</p>
            {actions}
        </section>
    </div>;
}

export function Gate({ feature, requiredPlan, children, preview }: { feature: string; requiredPlan?: Plan; children: ReactNode; preview?: ReactNode }) {
    const entitlements = useEntitlements();
    const session = useSession();
    const navigate = useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const minimumPlan = requiredPlan || entitlements.featureMinimumPlans[feature] || 'starter';
    useEffect(() => { if (contentRef.current) contentRef.current.inert = session.status === 'authenticated' && !entitlements.loading && !entitlements.features.includes(feature); }, [session.status, entitlements.loading, entitlements.features, feature]);
    if (session.status !== 'authenticated') return <>{children}</>;
    if (entitlements.loading) return <div className="plan-gate-shell" role="status">Checking your plan…</div>;
    if (entitlements.features.includes(feature)) return <>{children}</>;
    return <div className="plan-gate-shell">
        <div ref={contentRef} className="plan-gate-preview" aria-hidden="true">{preview || children}</div>
        {entitlements.status !== 'trial_expired' && <UpgradePrompt requiredPlan={minimumPlan} onClose={() => navigate('/app')} />}
    </div>;
}

export function RequirePlan({ feature, requiredPlan, children }: { feature: string; requiredPlan?: Plan; children: ReactNode }) {
    const entitlements = useEntitlements();
    if (entitlements.features.includes(feature)) return <>{children}</>;
    return <UpgradePrompt requiredPlan={requiredPlan || entitlements.featureMinimumPlans[feature] || 'starter'} blocking />;
}

export function TrialEndedPrompt() {
    const entitlements = useEntitlements();
    if (entitlements.status !== 'trial_expired') return null;
    return <UpgradePrompt requiredPlan="starter" blocking />;
}

export function UpgradePromptListener() {
    const [requiredPlan, setRequiredPlan] = useState<Plan | null>(null);
    const entitlements = useEntitlements();
    const session = useSession();
    useEffect(() => {
        const handle = (event: Event) => {
            if (session.status !== 'authenticated') return;
            const plan = (event as CustomEvent<{ requiredPlan?: Plan }>).detail?.requiredPlan;
            if (plan && ['starter', 'pro', 'enterprise'].includes(plan)) setRequiredPlan(plan);
        };
        window.addEventListener('qsvc:upgrade-required', handle);
        return () => window.removeEventListener('qsvc:upgrade-required', handle);
    }, [session.status]);
    useEffect(() => { if (entitlements.status === 'trial_expired') setRequiredPlan(null); }, [entitlements.status]);
    if (!requiredPlan || entitlements.status === 'trial_expired') return null;
    return <UpgradePrompt requiredPlan={requiredPlan} onClose={() => setRequiredPlan(null)} />;
}
