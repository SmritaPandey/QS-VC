import { describe, expect, it } from 'vitest';
import { canViewOrganisationMeetings, delegatedMeetingAccess, personalMeetingVisibility } from './meeting-visibility.js';

describe('meeting visibility', () => {
    it.each(['admin', 'business_admin', 'enterprise_admin'])('gives the verified %s role organisation scope', role => {
        expect(canViewOrganisationMeetings(role)).toBe(true);
    });

    it.each(['member', 'moderator', 'guest', 'business', 'enterprise', 'co-host', ''])('keeps %s in personal scope', role => {
        expect(canViewOrganisationMeetings(role)).toBe(false);
    });

    it('matches the specific plan owner and tenant and reserves controls for full admins', () => {
        const view = delegatedMeetingAccess('$3');
        expect(view).toContain('a.owner_id = meetings.host_id AND a.tenant_id = meetings.tenant_id');
        expect(view).toContain('a.delegate_id = $3');
        expect(view).not.toContain('a.role');
        expect(delegatedMeetingAccess('$3', true)).toContain("a.role = 'admin'");
    });

    it('restricts personal scope to the account’s hosting, attendance and current invitations', () => {
        const predicate = personalMeetingVisibility('$2');
        expect(predicate).toContain('meetings.host_id = $2');
        expect(predicate).toContain('p.meeting_id = meetings.id AND p.user_id = $2');
        expect(predicate).toContain('i.meeting_id = meetings.id AND i.tenant_id = meetings.tenant_id');
        expect(predicate).toContain("i.invitee_user_id = $2 AND i.invitation_status IN ('pending', 'accepted')");
    });
});
