import { useEffect, useRef, useState } from 'react';
import '../styles/checkout-progress.css';

export type CheckoutClock = { id: string; deadline: number };
export function calibrateCheckoutClock(previous: CheckoutClock | null, input: { id?: string; expiresAt?: string | null; serverNow?: string }, now = Date.now()): CheckoutClock | null {
    if (!input.id || !input.expiresAt || !input.serverNow) return null;
    const expires = Date.parse(input.expiresAt); const server = Date.parse(input.serverNow);
    if (!Number.isFinite(expires) || !Number.isFinite(server)) return null;
    const deadline = now + Math.max(0, expires - server);
    return { id: input.id, deadline: previous?.id === input.id ? Math.min(previous.deadline, deadline) : deadline };
}
export function checkoutTimeLeft(deadline: number, now = Date.now()) {
    const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export type CheckoutPhase = 'awaiting' | 'verifying' | 'dismissed' | 'expired' | 'confirmed';
export function CheckoutProgressContent({ phase, remaining, summary, hosted, canRetry, checking, onRefresh, onRetry }: {
    phase: CheckoutPhase; remaining?: string; summary?: string; hosted: boolean; canRetry: boolean; checking: boolean; onRefresh: () => void; onRetry: () => void;
}) {
    const titles: Record<CheckoutPhase, string> = { awaiting: 'Approve with your payment provider', verifying: 'Verifying your payment setup', dismissed: 'Checkout window closed', expired: 'Approval window ended', confirmed: 'Payment setup confirmed' };
    const descriptions: Record<CheckoutPhase, string> = {
        awaiting: 'Complete approval with your provider. Your plan activates only after server confirmation.',
        verifying: 'Provider approval is being checked. Do not start another payment while confirmation is pending.',
        dismissed: 'Closing checkout does not cancel an approved payment. Check status before trying again.',
        expired: 'Checking provider status. Do not approve the old checkout. If you paid, do not pay again.',
        confirmed: 'Your requested plan access has been verified.',
    };
    return <section className={`checkout-progress checkout-progress--${phase}`} aria-label="Checkout progress">
        <div className="checkout-progress-heading"><span className="mi" aria-hidden="true">{phase === 'confirmed' ? 'check_circle' : phase === 'expired' ? 'schedule' : 'account_balance_wallet'}</span><h3>{titles[phase]}</h3></div>
        {summary && <p>{summary}</p>}
        <p role="status" aria-live="polite">{descriptions[phase]}</p>
        {remaining && phase !== 'confirmed' && phase !== 'verifying' && <div className="checkout-time"><span>Approval time remaining</span><span aria-hidden="true" className="checkout-countdown">{remaining}</span><span className="sr-only">The approval window lasts three minutes. Status is checked when time ends.</span></div>}
        {hosted && phase !== 'confirmed' && <p className="checkout-hosted-note">Checkout redirects to the provider’s page in this tab. Return to QS-VC to see this countdown and status; provider and bank screens may use their own timing.</p>}
        <ol className="checkout-steps" aria-label="Payment setup stages">
            <li data-complete="true"><span aria-hidden="true">1</span>Checkout created</li>
            <li data-current={phase === 'awaiting' || phase === 'dismissed'} data-complete={phase === 'verifying' || phase === 'confirmed'}><span aria-hidden="true">2</span>Provider approval</li>
            <li data-current={phase === 'verifying'} data-complete={phase === 'confirmed'}><span aria-hidden="true">3</span>Server confirmation</li>
        </ol>
        {phase !== 'confirmed' && <div className="checkout-progress-actions"><button className="btn-secondary" type="button" disabled={checking} onClick={onRefresh}>{checking ? 'Checking status…' : 'Check payment status'}</button>
            {phase === 'expired' && canRetry && <button className="btn-primary" type="button" onClick={onRetry}>Start a new checkout</button>}</div>}
    </section>;
}
export default function CheckoutProgress({ clock, phase, onExpired, ...props }: {
    clock: CheckoutClock | null; phase: CheckoutPhase; summary?: string; hosted: boolean; canRetry: boolean; checking: boolean;
    onRefresh: () => void; onRetry: () => void; onExpired: () => void;
}) {
    const [now, setNow] = useState(Date.now);
    const expiryCallback = useRef(onExpired); expiryCallback.current = onExpired;
    const expiredId = useRef<string>();
    const timedOut = Boolean(clock && now >= clock.deadline && phase !== 'confirmed' && phase !== 'verifying');
    useEffect(() => {
        if (!clock || phase === 'confirmed' || phase === 'verifying') return;
        const tick = () => setNow(Date.now());
        tick();
        const interval = window.setInterval(tick, 1000);
        document.addEventListener('visibilitychange', tick); window.addEventListener('focus', tick);
        return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
    }, [clock?.id, phase === 'confirmed', phase === 'verifying']);
    useEffect(() => {
        if (timedOut && clock && expiredId.current !== clock.id) { expiredId.current = clock.id; expiryCallback.current(); }
    }, [timedOut, clock?.id]);
    return <CheckoutProgressContent {...props} phase={timedOut ? 'expired' : phase} remaining={clock ? checkoutTimeLeft(clock.deadline, now) : undefined} />;
}
