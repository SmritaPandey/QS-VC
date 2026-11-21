import { useEffect, useRef, useState } from 'react';
import { signaling } from '../lib/signaling';
import { downloadText } from '../lib/caption-stream';
import '../styles/meeting-summary-panel.css';

interface SummaryState {
    active: boolean;
    hasSpeech?: boolean;
    text?: string;
    saved?: boolean;
    message?: string;
}

interface Props {
    open: boolean;
    onClose: () => void;
    code: string;
    isHost?: boolean;
    canManage?: boolean;
}

type TabType = 'overview' | 'actions' | 'decisions' | 'full';

export default function MeetingSummaryPanel({ open, onClose, code, canManage = false }: Props) {
    const [state, setState] = useState<SummaryState>({ active: false });
    const [busy, setBusy] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    const [copied, setCopied] = useState(false);
    const [summaryError, setSummaryError] = useState('');
    const panelRef = useRef<HTMLDivElement>(null);

    // Refresh summary from signaling
    const fetchSummary = async (triggerUpdate = false) => {
        try {
            const result = await signaling.request('liveSummaryState', { refresh: triggerUpdate });
            if (result) {
                setSummaryError('');
                setState(prev => ({
                    ...prev,
                    active: result.active ?? prev.active,
                    hasSpeech: result.hasSpeech,
                    text: result.text,
                    saved: result.saved,
                    message: result.message,
                }));
            }
        } catch {
            setSummaryError('Could not load the recap. Use Update to try again.');
        }
    };

    // Trigger on-demand AI summary generation from transcript if available
    const generateOnDemandSummary = async () => {
        if (busy || refreshing) return;
        setRefreshing(true);
        try {
            await fetchSummary(canManage);
        } finally {
            setRefreshing(false);
        }
    };

    // When the panel is opened: immediately summarize the meeting using AI
    useEffect(() => {
        if (!open) return;

        // Auto-focus panel
        panelRef.current?.focus();

        void fetchSummary(canManage);

        // 3. Listen for live summary updates
        const off = signaling.on('liveSummaryChanged', (event: { active: boolean; hasSpeech?: boolean }) => {
            setState(prev => ({ ...prev, active: event.active, hasSpeech: event.hasSpeech }));
            fetchSummary(canManage && event.hasSpeech === true);
        });

        // Periodic light refresh while open
        const interval = window.setInterval(() => {
            fetchSummary(false);
        }, 5000);

        return () => {
            off();
            window.clearInterval(interval);
        };
    }, [open, code, canManage]);

    // Host control: Start or stop live summary
    const toggleLiveSummary = async () => {
        if (busy) return;
        setBusy(true);
        setSummaryError('');
        try {
            const next = await signaling.request(state.active ? 'stopLiveSummary' : 'startLiveSummary');
            setState(prev => ({ ...prev, ...next }));
        } catch (err) {
            setSummaryError(err instanceof Error ? err.message : 'Could not update AI summary.');
        } finally {
            setBusy(false);
        }
    };

    const currentText = state.text || '';

    // Parse sections from summary markdown
    const parseSections = (text: string) => {
        const sections: { overview: string; actions: string; decisions: string } = {
            overview: '',
            actions: '',
            decisions: '',
        };

        if (!text) return sections;

        const lines = text.split('\n');
        let currentSection: 'overview' | 'actions' | 'decisions' | 'other' = 'overview';

        for (const line of lines) {
            const heading = line.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/:$/, '').toLowerCase();
            if (['action items', 'actions', 'next steps'].includes(heading)) {
                currentSection = 'actions';
                continue;
            }
            if (['decisions', 'key decisions', 'conclusions'].includes(heading)) {
                currentSection = 'decisions';
                continue;
            }
            if (/^#{1,6}\s/.test(line.trim()) || heading === 'overview') {
                currentSection = 'overview';
            }

            if (currentSection === 'actions') {
                sections.actions += line + '\n';
            } else if (currentSection === 'decisions') {
                sections.decisions += line + '\n';
            } else {
                sections.overview += line + '\n';
            }
        }

        return sections;
    };

    const parsed = parseSections(currentText);

    const handleCopy = async () => {
        if (!currentText) return;
        try {
            await navigator.clipboard.writeText(currentText);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    const handleDownload = () => {
        if (!currentText) return;
        downloadText(`${code}-ai-summary.md`, currentText);
    };

    if (!open) return null;

    return (
        <div
            id="meeting-summary-panel"
            ref={panelRef}
            className="side-panel meeting-summary-panel"
            role="complementary"
            aria-label="AI Meeting Summary"
            tabIndex={-1}
            onKeyDown={event => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    onClose();
                }
            }}
        >
            <div className="panel-header">
                <h3 className="summary-title">AI summary</h3>
                <button type="button" className="panel-close" aria-label="Close summary panel" onClick={onClose}>
                    <span className="mi" aria-hidden="true">close</span>
                </button>
            </div>
            <div className="summary-speech-bar" role="status">
                <span className={`summary-status-dot ${refreshing ? 'is-busy' : state.active ? (state.hasSpeech ? 'is-live' : 'is-waiting') : 'is-off'}`} />
                <span className="summary-speech-text">
                    {refreshing ? 'Updating recap…' : state.message || (!state.active ? 'Live summary is off' :
                        state.hasSpeech ? 'Live summary on · Speech received' : 'Waiting for speech')}
                </span>
            </div>
            {currentText && (
                <nav className="summary-tabs-nav" aria-label="Summary sections">
                    {([['overview', 'Overview'], ['actions', 'Actions'], ['decisions', 'Decisions'], ['full', 'Full recap']] as const)
                        .map(([tab, label]) => (
                            <button type="button" key={tab} aria-pressed={activeTab === tab}
                                onClick={() => setActiveTab(tab)}>{label}</button>
                        ))}
                </nav>
            )}
            <div className="summary-body">
                {summaryError && <p className="summary-error" role="alert">{summaryError}</p>}
                {currentText ? (
                    <div className="summary-prose" key={activeTab}>
                        {activeTab === 'full' ? currentText :
                            activeTab === 'overview' ? parsed.overview.trim() || currentText :
                            parsed[activeTab].trim() || (activeTab === 'actions' ? 'No action items yet.' : 'No decisions yet.')}
                    </div>
                ) : (
                    <div className="summary-placeholder">
                        <span className="mi summary-placeholder-icon" aria-hidden="true">auto_awesome</span>
                        <p className="summary-placeholder-text">
                            {state.active ? 'The recap appears here once participants share speech as captions.' :
                                canManage ? 'Start live notes to build a recap from shared captions.' : 'The host or co-host can start live notes.'}
                        </p>
                    </div>
                )}
            </div>

            {/* Bottom Actions Toolbar */}
            <div className="summary-footer-actions">
                <button
                    type="button"
                    className="summary-action-btn"
                    disabled={refreshing}
                    title="Generate fresh AI summary from current speech"
                    onClick={generateOnDemandSummary}
                >
                    <span className={`mi mi-sm ${refreshing ? 'spinning' : ''}`} aria-hidden="true">
                        refresh
                    </span>
                    <span>{refreshing ? 'Updating…' : 'Update'}</span>
                </button>

                <button
                    type="button"
                    className="summary-action-btn"
                    hidden={!currentText}
                    title="Copy summary text"
                    onClick={handleCopy}
                >
                    <span className="mi mi-sm" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>
                    <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>

                <button
                    type="button"
                    className="summary-action-btn"
                    hidden={!currentText}
                    title="Download summary as markdown"
                    onClick={handleDownload}
                >
                    <span className="mi mi-sm" aria-hidden="true">download</span>
                    <span>Download</span>
                </button>

                {canManage && (
                    <button
                        type="button"
                        className={`summary-action-btn summary-live-toggle ${state.active ? 'active-recording' : ''}`}
                        disabled={busy}
                        title={state.active ? 'Stop live automatic summary' : 'Start live automatic summary'}
                        onClick={toggleLiveSummary}
                    >
                        <span className="mi mi-sm" aria-hidden="true">
                            {state.active ? 'stop_circle' : 'play_arrow'}
                        </span>
                        <span>{busy ? '…' : state.active ? 'Stop notes' : 'Start notes'}</span>
                    </button>
                )}
            </div>
        </div>
    );
}
