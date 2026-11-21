import { afterEach, expect, it, vi } from 'vitest';
import { addSummaryCaption, finishLiveSummary, liveSummaryState, startLiveSummary, stopLiveSummary } from './live-summary.js';
import { generateMeetingSummary } from './ai-meeting-summary.js';
import { saveTranscript } from './transcript-store.js';
import { roomManager } from './room-manager.js';

vi.mock('./room-manager.js', () => ({roomManager: { broadcast: vi.fn() }}));
vi.mock('./ai-meeting-summary.js', () => ({generateMeetingSummary: vi.fn(async () => 'Recap')}));
vi.mock('./transcript-store.js', () => ({saveTranscript: vi.fn(async () => true)}));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('announces active state, summarizes new shared speech and saves the final update', async () => {
    vi.useFakeTimers();
    const entry = {id:'1', peerId:'p', speaker:'A', language:'en', text:'Discuss the release', timestamp:Date.now()};
    addSummaryCaption('room', 'code', entry);
    startLiveSummary('room');
    expect(roomManager.broadcast).toHaveBeenCalledWith('room', 'liveSummaryChanged', {active:true});
    expect(liveSummaryState('room', false)).toEqual({active:true});
    addSummaryCaption('room', 'code', entry);
    await vi.advanceTimersByTimeAsync(30000);
    expect(generateMeetingSummary).toHaveBeenCalledTimes(1);
    addSummaryCaption('room', 'code', {...entry,id:'2'});
    await stopLiveSummary('room', 'code');
    expect(liveSummaryState('room', true)).toMatchObject({active:false,text:'Recap',saved:true});
    expect(saveTranscript).toHaveBeenCalledTimes(2);
    await finishLiveSummary('room','code');
    expect(liveSummaryState('room',true)).toEqual({active:false});
});
