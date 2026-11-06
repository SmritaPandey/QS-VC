export type DownloadState =
    | { phase: 'idle' }
    | { phase: 'working'; received: number; total: number | null }
    | { phase: 'done'; checksum: string; size: number; archive: 'macos' | 'windows' | 'linux' }
    | { phase: 'error'; message: string };

function megabytes(bytes: number) { return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`; }

/**
 * Whole-window feedback for a download: the viewport edge glows (teal while working,
 * brighter on success, red on failure) and a message card reports progress and the result.
 */
export default function DownloadFeedback({ state, onDismiss }: { state: DownloadState; onDismiss: () => void }) {
    if (state.phase === 'idle') return null;
    const percent = state.phase === 'working' && state.total ? Math.min(100, Math.round(state.received / state.total * 100)) : null;
    return <>
        <div className="download-glow" data-phase={state.phase} aria-hidden="true" />
        <div className="download-toast" data-phase={state.phase} role={state.phase === 'error' ? 'alert' : 'status'} aria-live={state.phase === 'error' ? 'assertive' : 'polite'}>
            <span className="download-toast-icon mi" aria-hidden="true">{state.phase === 'working' ? 'downloading' : state.phase === 'done' ? 'task_alt' : 'error'}</span>
            <div className="download-toast-body">
                {state.phase === 'working' && <>
                    <strong>Downloading QS-VC…</strong>
                    <span>{percent !== null ? `${percent}% · ${megabytes(state.received)} of ${megabytes(state.total!)}` : `${megabytes(state.received)} received`}</span>
                    <span className="download-progress" data-indeterminate={percent === null || undefined}><i style={percent !== null ? { width: `${percent}%` } : undefined} /></span>
                </>}
                {state.phase === 'done' && <>
                    <strong>Download complete.</strong>
                    {state.archive === 'macos'
                        ? <span>The Mac ZIP ({megabytes(state.size)}) is in Downloads. Open it to extract QS-VC.app, then move the app to Applications.</span>
                        : state.archive === 'linux'
                            ? <span>The Linux x64 tar.gz ({megabytes(state.size)}) is in Downloads. Extract it and run QS-VC from the extracted folder.</span>
                            : <span>The Windows ZIP ({megabytes(state.size)}) is in Downloads. Extract it and run QS-VC-Windows-Setup.exe.</span>}
                    <span className="download-checksum">SHA-256: <code>{state.checksum}</code></span>
                    <span>Compare the checksum with the value supplied by your administrator before installing.</span>
                </>}
                {state.phase === 'error' && <>
                    <strong>Download failed.</strong>
                    <span>{state.message}</span>
                </>}
            </div>
            {state.phase !== 'working' && <button type="button" className="download-toast-close" aria-label="Dismiss message" onClick={onDismiss}><span className="mi" aria-hidden="true">close</span></button>}
        </div>
    </>;
}
