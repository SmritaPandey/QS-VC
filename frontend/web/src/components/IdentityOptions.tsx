import { Link, useLocation } from 'react-router-dom';

export default function IdentityOptions() {
    const { search } = useLocation();
    return <div className="identity-options">
        <p>Using an organisation account? <Link to={`/login${search}`}>Sign in with your organisation</Link></p>
    </div>;
}
