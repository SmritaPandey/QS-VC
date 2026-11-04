import { useEffect, useRef, useState } from 'react';
import { watchVoiceLevel } from './voice-activity';

/**
 * Who is speaking right now, for everyone in the call (not just tiles on screen), so the grid,
 * the People panel and page ordering all agree. Levels are read locally from audio tracks we
 * already receive; nothing is sent anywhere.
 */
export interface SpeakingState {
    /** ids currently talking (with a short hold so it doesn't flicker between words) */
    speaking: Set<string>;
    /** most recent clear speaker, kept for a few seconds — used for "active speaker" ordering */
    activeSpeaker: string | null;
}

const HOLD_MS = 700;
const ACTIVE_HOLD_MS = 4000;

export function speakingKey(ids: Set<string>): string { return [...ids].sort().join('|'); }

export function useSpeaking(tracks: Array<{ id: string; track?: MediaStreamTrack | null; muted?: boolean }>): SpeakingState {
    const [state, setState] = useState<SpeakingState>({ speaking: new Set(), activeSpeaker: null });
    const lastHeard = useRef(new Map<string, number>());
    const levels = useRef(new Map<string, number>());
    const active = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });
    const signature = tracks.map(t => `${t.id}:${t.track?.id || ''}:${t.muted ? 1 : 0}`).join(',');

    useEffect(() => {
        const stops = tracks.filter(t => t.track && t.track.readyState === 'live' && !t.muted).map(({ id, track }) =>
            watchVoiceLevel(track!, level => {
                levels.current.set(id, level);
                if (level > 0.15) lastHeard.current.set(id, Date.now());
            }));
        const live = new Set(tracks.map(t => t.id));
        for (const id of [...lastHeard.current.keys()]) if (!live.has(id)) { lastHeard.current.delete(id); levels.current.delete(id); }
        const timer = window.setInterval(() => {
            const now = Date.now();
            const speaking = new Set<string>();
            for (const [id, at] of lastHeard.current) if (now - at < HOLD_MS) speaking.add(id);
            // Loudest current speaker becomes the active speaker; it sticks for a few seconds.
            let loudest: string | null = null, best = 0.25;
            for (const [id, level] of levels.current) if (level > best && speaking.has(id)) { best = level; loudest = id; }
            if (loudest) active.current = { id: loudest, at: now };
            else if (active.current.id && now - active.current.at > ACTIVE_HOLD_MS) active.current = { id: null, at: now };
            setState(prev => (speakingKey(prev.speaking) === speakingKey(speaking) && prev.activeSpeaker === active.current.id)
                ? prev : { speaking, activeSpeaker: active.current.id });
        }, 200);
        return () => { stops.forEach(stop => stop()); window.clearInterval(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);
    return state;
}
