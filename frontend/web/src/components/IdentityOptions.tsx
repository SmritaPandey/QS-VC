export default function IdentityOptions() {
    return <div className="identity-options" aria-label="Additional sign-in options"><p>Organisation and connected accounts</p>{['Google', 'Microsoft', 'Organisation SSO / SAML'].map(provider => <button type="button" disabled key={provider}><span>{provider}</span><small>Not connected yet</small></button>)}<p>These options are placeholders. Use your assigned account until your administrator connects a provider.</p></div>;
}
