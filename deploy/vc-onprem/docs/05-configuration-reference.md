# Configuration reference

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

Use config/.env.onprem.template and the P0 configuration inventory. DOMAIN, QSVC_ADMIN_EMAILS, SFU_ANNOUNCED_IP and TURN_ALLOWED_SFU_IP are site inputs. Require distinct random credentials, no shared defaults. Offline overlay disables cloud identity, email, billing, remote AI and recording. Change profiles through a newly signed release. VITE_* values are build-time public settings. Compose runtime web environment does not recompile frontend assets. Keep root-only deployment variables separate from browser settings. Full validation rules remain open.
