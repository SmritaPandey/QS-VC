import { z } from 'zod';

export const createMeetingSchema = (maxMeetingParticipants: number) => z.object({
    title: z.string().trim().min(1).max(255).optional(),
    type: z.enum(['instant', 'scheduled', 'recurring']).default('instant'),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
    recurrence: z.object({ frequency: z.enum(['daily', 'weekly']), count: z.number().int().min(2).max(12) }).optional(),
    settings: z.object({
        maxParticipants: z.number().int().min(2).max(maxMeetingParticipants).default(Math.min(100, maxMeetingParticipants)),
        waitingRoom: z.boolean().default(true),
        webinar: z.boolean().default(false),
        meetingKind: z.enum(['instant', 'conference', 'team', 'town_hall', 'webinar']).optional(),
        e2eeRequired: z.boolean().default(true),
        recordingAllowed: z.boolean().default(true),
        chatEnabled: z.boolean().default(true),
        screenShareEnabled: z.boolean().default(true),
    }).optional(),
});
