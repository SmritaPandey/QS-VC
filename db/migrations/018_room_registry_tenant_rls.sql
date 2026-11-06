-- Keep room inventory and device records inside the same forced tenant boundary
-- as meetings. Signaling has no database credential; only the meeting service
-- role is granted access to these tables.
ALTER TABLE public.room_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_numbers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.room_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_devices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_room_numbers ON public.room_numbers;
CREATE POLICY tenant_isolation_room_numbers ON public.room_numbers
    TO qsvc_meeting_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation_room_devices ON public.room_devices;
CREATE POLICY tenant_isolation_room_devices ON public.room_devices
    TO qsvc_meeting_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
