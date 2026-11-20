import type { MeetingKind } from '../components/MeetingSetupDialog';
import type { ViewMode } from '../components/VideoGrid';

export type FormatAction = 'breakouts' | 'notes' | 'board' | 'questions' | 'polls' | 'captions' | 'host';

export const MEETING_FORMATS = {
    conference: { label: 'Conference', icon: 'groups', layout: 'sidebar', actions: ['breakouts'] },
    team: { label: 'Team meeting', icon: 'workspaces', layout: 'tiled', actions: ['notes', 'board'] },
    webinar: { label: 'Webinar', icon: 'cast_for_education', layout: 'spotlight', actions: ['questions', 'polls'] },
    town_hall: { label: 'Town hall', icon: 'podium', layout: 'sidebar', actions: ['questions', 'captions', 'host'] },
} as const satisfies Record<MeetingKind, { label: string; icon: string; layout: ViewMode; actions: readonly FormatAction[] }>;

export const FORMAT_ACTIONS: Record<FormatAction, { label: string; icon: string }> = {
    breakouts: { label: 'Breakout rooms', icon: 'meeting_room' },
    notes: { label: 'Shared notes', icon: 'description' },
    board: { label: 'Whiteboard', icon: 'draw' },
    questions: { label: 'Q&A', icon: 'forum' },
    polls: { label: 'Polls', icon: 'poll' },
    captions: { label: 'Captions', icon: 'closed_caption' },
    host: { label: 'Moderation', icon: 'shield_person' },
};

export function roomFormat(settings?: { meetingKind?: string; webinar?: boolean }): MeetingKind {
    const kind = settings?.meetingKind;
    return kind === 'conference' || kind === 'team' || kind === 'webinar' || kind === 'town_hall'
        ? kind
        : settings?.webinar ? 'town_hall' : 'conference';
}
