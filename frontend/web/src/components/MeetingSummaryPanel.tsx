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
            // best-effort
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
            const lower = line.toLowerCase();
            if (lower.includes('action item') || lower.includes('actions') || lower.includes('next step')) {
                currentSection = 'actions';
                continue;
            } else if (lower.includes('decision') || lower.includes('agreed') || lower.includes('conclusions')) {
                currentSection = 'decisions';
                continue;
            } else if (lower.startsWith('## ') || lower.startsWith('### ')) {
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
            {/* Clean Header */}
            <div className="panel-header">
                <div className="summary-header-brand">
                    <span className="mi summary-brand-icon" aria-hidden="true">auto_awesome</span>
                    <div>
                        <h3 className="summary-title">AI Meeting Summary</h3>
                        <span className="summary-subtitle">Live Quantum-Safe Intelligence</span>
                    </div>
                </div>
                <button
                    type="button"
                    className="panel-close"
                    aria-label="Close summary panel"
                    onClick={onClose}
                >
                    <span className="mi mi-sm" aria-hidden="true">close</span>
                </button>
            </div>

            {/* Speech Status Indicator Strip */}
            <div
                className={`summary-speech-bar ${state.hasSpeech ? 'status-speaking' : 'status-waiting'}`}
                role="status"
            >
                {state.hasSpeech ? (
                    <>
                        <span className="speech-pulse-dot" aria-hidden="true" />
                        <span className="speech-status-label">Meeting speech active · AI summarizing live</span>
                    </>
                ) : (
                    <>
                        <span className="mi mi-sm speech-idle-icon" aria-hidden="true">hourglass_empty</span>
                        <span className="speech-status-label">Waiting for speech · AI will summarize as participants speak</span>
                    </>
                )}
            </div>

            {/* Slideable Navigation Tabs */}
            <nav className="summary-tabs-nav" aria-label="Summary Sections">
                <button
                    type="button"
                    className={`summary-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                    onClick={() => setActiveTab('overview')}
                >
                    <span className="mi mi-sm" aria-hidden="true">subject</span> Overview
                </button>
                <button
                    type="button"
                    className={`summary-tab-btn ${activeTab === 'actions' ? 'active' : ''}`}
                    onClick={() => setActiveTab('actions')}
                >
                    <span className="mi mi-sm" aria-hidden="true">task_alt</span> Action Items
                </button>
                <button
                    type="button"
                    className={`summary-tab-btn ${activeTab === 'decisions' ? 'active' : ''}`}
                    onClick={() => setActiveTab('decisions')}
                >
                    <span className="mi mi-sm" aria-hidden="true">gavel</span> Decisions
                </button>
                <button
                    type="button"
                    className={`summary-tab-btn ${activeTab === 'full' ? 'active' : ''}`}
                    onClick={() => setActiveTab('full')}
                >
                    <span className="mi mi-sm" aria-hidden="true">article</span> Full Recap
                </button>
            </nav>

            {/* Tab Body with Smooth Slides */}
            <div className="summary-body" role="region" aria-live="polite">
                {refreshing && (
                    <div className="summary-refresh-banner" role="status">
                        <span className="summary-spinner" aria-hidden="true" />
                        <span>Updating summary with AI…</span>
                    </div>
                )}

                {summaryError && <p className="summary-error" role="alert">{summaryError}</p>}

                {!currentText && !refreshing ? (
                    <div className="summary-empty-state">
                        <span className="mi summary-empty-icon" aria-hidden="true">mic_none</span>
                        <h4>Waiting for speech</h4>
                        <p>
                            {canManage ? 'The recap updates from speech participants share as captions.' : 'The host or co-host manages the meeting recap.'}
                        </p>
                        <button
                            type="button"
                            className="summary-btn summary-btn-primary"
                            disabled={refreshing}
                            onClick={generateOnDemandSummary}
                        >
                            <span className="mi mi-sm" aria-hidden="true">refresh</span> Check for Updates
                        </button>
                    </div>
                ) : (
                    <div className="summary-content-card">
                        {activeTab === 'overview' && (
                            <div className="summary-tab-pane slide-fade">
                                <h4 className="summary-section-heading">Executive Overview</h4>
                                <div className="summary-prose">
                                    {parsed.overview.trim() ? parsed.overview : currentText}
                                </div>
                            </div>
                        )}

                        {activeTab === 'actions' && (
                            <div className="summary-tab-pane slide-fade">
                                <h4 className="summary-section-heading">Action Items & Deliverables</h4>
                                {parsed.actions.trim() ? (
                                    <div className="summary-prose">{parsed.actions}</div>
                                ) : (
                                    <p className="summary-placeholder">No action items detected in current discussion yet.</p>
                                )}
                            </div>
                        )}

                        {activeTab === 'decisions' && (
                            <div className="summary-tab-pane slide-fade">
                                <h4 className="summary-section-heading">Decisions & Agreements</h4>
                                {parsed.decisions.trim() ? (
                                    <div className="summary-prose">{parsed.decisions}</div>
                                ) : (
                                    <p className="summary-placeholder">No formal decisions recorded in current discussion yet.</p>
                                )}
                            </div>
                        )}

                        {activeTab === 'full' && (
                            <div className="summary-tab-pane slide-fade">
                                <h4 className="summary-section-heading">Complete Meeting Record</h4>
                                <pre className="summary-raw-pre">{currentText}</pre>
                            </div>
                        )}
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
                    <span>{refreshing ? 'Summarizing…' : 'Update'}</span>
                </button>

                <button
                    type="button"
                    className="summary-action-btn"
                    disabled={!currentText}
                    title="Copy summary text"
                    onClick={handleCopy}
                >
                    <span className="mi mi-sm" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>
                    <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>

                <button
                    type="button"
                    className="summary-action-btn"
                    disabled={!currentText}
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
                        <span>{busy ? '…' : state.active ? 'Active' : 'Start Live'}</span>
                    </button>
                )}
            </div>
        </div>
    );
}
