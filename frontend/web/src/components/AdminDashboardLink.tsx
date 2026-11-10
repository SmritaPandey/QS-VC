import { Link } from 'react-router-dom';
import { useSession } from '../lib/use-session';

export default function AdminDashboardLink({ onClick }: { onClick?: () => void }) {
    const session = useSession();
    if (session.status !== 'authenticated' || session.profile?.isPlatformAdmin !== true) return null;
    return <Link to="/admin" onClick={onClick}>Admin dashboard</Link>;
}
