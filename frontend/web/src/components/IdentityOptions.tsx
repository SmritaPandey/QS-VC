import ActionContents from './ActionContents';

export default function IdentityOptions() {
    return <div className="identity-options" aria-label="Additional sign-in options">
        <p>Or sign in with</p>
        <div className="identity-options-grid">
            {['Google', 'Microsoft', 'Organisation SSO / SAML'].map(provider => <button className="qsvc-action qsvc-action--secondary" type="button" disabled title="Not connected yet" key={provider}><ActionContents>{provider}</ActionContents></button>)}
        </div>
        <p>Provider sign-in is not connected yet. Quantum-Premise users sign in through their organisation’s SSO / SAML once enabled.</p>
    </div>;
}
