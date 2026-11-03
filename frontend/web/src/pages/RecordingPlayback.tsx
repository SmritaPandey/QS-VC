import ActionContents from '../components/ActionContents';
import { Link } from 'react-router-dom';

export default function RecordingPlayback() {
    return <main className="recording-page"><div className="recording-empty">
        <h1>Recording is disabled</h1><p>This demo does not create or provide access to meeting recordings.</p>
        <Link className="btn-primary qsvc-action" to="/app"><ActionContents>Back to meetings</ActionContents></Link>
    </div></main>;
}
