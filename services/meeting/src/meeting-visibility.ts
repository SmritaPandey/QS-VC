export function canViewOrganisationMeetings(role: string): boolean {
    return role === 'admin' || role === 'business_admin' || role === 'enterprise_admin';
}

// The enclosing query must already scope meetings to the verified account's tenant.
export function personalMeetingVisibility(account: string): string {
    return `(meetings.host_id = ${account}
        OR EXISTS (SELECT 1 FROM meeting_participants p
            WHERE p.meeting_id = meetings.id AND p.user_id = ${account})
        OR EXISTS (SELECT 1 FROM meeting_invitations i
            WHERE i.meeting_id = meetings.id AND i.tenant_id = meetings.tenant_id
                AND i.invitee_user_id = ${account} AND i.invitation_status IN ('pending', 'accepted')))`;
}

export function delegatedMeetingAccess(account: string, control = false): string {
    return `EXISTS (SELECT 1 FROM public.active_plan_meeting_admins a
        WHERE a.owner_id = meetings.host_id AND a.tenant_id = meetings.tenant_id
            AND a.delegate_id = ${account}${control ? " AND a.role = 'admin'" : ''})`;
}
