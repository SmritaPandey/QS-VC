import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import PreMeeting from './pages/PreMeeting';
import MeetingRoom from './pages/MeetingRoom';
import MeetingEnd from './pages/MeetingEnd';
import RecordingPlayback from './pages/RecordingPlayback';
import AdminDashboard from './pages/AdminDashboard';
import ScheduleMeeting from './pages/ScheduleMeeting';

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/schedule" element={<ScheduleMeeting />} />
                <Route path="/meeting/:meetingCode/preview" element={<PreMeeting />} />
                <Route path="/meeting/:meetingCode" element={<MeetingRoom />} />
                <Route path="/meeting-end" element={<MeetingEnd />} />
                <Route path="/recordings/:meetingId" element={<RecordingPlayback />} />
                <Route path="/admin" element={<AdminDashboard />} />
            </Routes>
        </BrowserRouter>
    );
}
