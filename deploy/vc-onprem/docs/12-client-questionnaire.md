# Client intake and working assumptions

Return this form without passwords, private keys, tokens or credential files.
Recommendations are proposals, not supported-platform or capacity guarantees.
Unknown is a valid answer; assign an owner to resolve it before P1 approval.

| Input | Client answer | Recommended starting point |
|---|---|---|
| Hypervisor product and exact version | ASSUMED – pending client approval | Use the client's supported platform; do not introduce a new hypervisor |
| Accepted import format | ASSUMED – pending client approval | Native client format: OVA/OVF for approved VMware workflow, VHDX for Hyper-V, QCOW2 for KVM; confirm version compatibility |
| Vendor image permitted or client gold image required | ASSUMED – pending client approval | Bundle on the client's approved hardened gold image; image pipeline only if permitted |
| Mandated OS and exact version | ASSUMED – pending client approval | Minimal Ubuntu 24.04 LTS candidate if there is no mandate; Rocky/Alma 9 candidate where required, with separate validation before support is claimed |
| CIS/STIG baseline and exceptions | ASSUMED – pending client approval | Client-approved CIS baseline; SELinux/AppArmor enforcing; document container/media exceptions |
| Patch policy and package mirror | ASSUMED – pending client approval | Approved internal mirror and scheduled tested security updates |
| Internet, proxy or air gap; offline registry/repository | ASSUMED – pending client approval | Design for no runtime internet; build/mirror on a controlled connected host |
| Concurrent users / rooms / maximum per room | ASSUMED – pending client approval | Propose a pilot workload of 25 concurrent users, 5 rooms, max 10 per room; benchmark before any production commitment |
| Recording hours per day, retention and deletion rules | ASSUMED – pending client approval | Recording disabled until storage integration is validated; propose 30-day retention if permitted |
| AI languages, directions, captions, translation, minutes | ASSUMED – pending client approval | Explicit client language list and representative audio/text; local processors, no remote browser recognition assumption |
| E2EE and server processing policy | ASSUMED – pending client approval | E2EE enabled where required; server ASR unavailable for encrypted audio until reviewed explicit sharing/consent is approved |
| Single node vs HA; VM count and roles | ASSUMED – pending client approval | Single-node pilot only if acceptable; production HA requires separate architecture and failover validation |
| Available vCPU / RAM / disk / IOPS per VM | ASSUMED – pending client approval | Supply quotas and storage latency/IOPS report; approve allocation after benchmark, not guessed sizing |
| GPU and transcoding / MCU demand | ASSUMED – pending client approval | No GPU requirement assumed; benchmark selected AI/MCU workload before purchase |
| Storage type and capacity; SAN/NAS/local | ASSUMED – pending client approval | Persistent client-managed storage and separate backup destination; recording capacity derived from measured bitrate and retention |
| MPLS L3VPN/private-only routing | ASSUMED – pending client approval | Private unicast connectivity with explicit return routes; no internet dependency |
| Client subnets / VLAN / VM IP / gateway | ASSUMED – pending client approval | Client assigns reserved static addresses; no invented ranges |
| DNS / search domain / NTP / A and PTR records | ASSUMED – pending client approval | Client internal DNS and NTP with stable service names |
| NAT / overlapping subnets / static routes / BGP | ASSUMED – pending client approval | No NAT or overlaps where possible; client network team owns routing and advertisements |
| MTU / QoS / DSCP | ASSUMED – pending client approval | Start with client-approved MTU and media policy; measure path MTU, loss and jitter before setting thresholds |
| Firewall/proxy locations and change owner | ASSUMED – pending client approval | Named client network owner; least-privilege per-flow rules |
| UDP permitted? TLS 443 fallback mandatory? | ASSUMED – pending client approval | Permit scoped media UDP where possible; treat TURN/TLS 443 as a separate tested requirement |
| Multicast permitted/required | ASSUMED – pending client approval | Unicast; no multicast requirement in current application |
| Internal TURN names / IPs / ports / relay range | ASSUMED – pending client approval | Client-hosted coturn; evaluate 3478 TCP/UDP, optional 5349 TLS and existing 49152–49200 UDP relay range; 443 needs approved listener topology |
| Poly models / gateway / FreeSWITCH availability | ASSUMED – pending client approval | Disable optional MCU profile until actual gateway and endpoint interoperability is verified |
| Local accounts / AD / LDAP / SAML / OIDC | ASSUMED – pending client approval | Local accounts for isolated pilot; client IdP integration for production if required, with a test tenant |
| TLS names / issuing CA / renewal owner | ASSUMED – pending client approval | Client internal CA, complete chain and endpoint trust; named renewal owner |
| Logs / SIEM / syslog / SNMP / Prometheus / Grafana | ASSUMED – pending client approval | Client log target with redaction and retention; do not claim adapters absent from current code |
| Residency / encryption at rest / log and data retention | ASSUMED – pending client approval | All processing and data stay on approved client infrastructure; client storage encryption and documented retention |
| Backup destination / RPO / RTO / restore test | ASSUMED – pending client approval | Propose RPO 24 hours and RTO 4 hours for pilot only; client approves production targets and restore evidence |
| Secure transfer / portable media / artifact approval | ASSUMED – pending client approval | Approved secure transfer with SHA-256 manifest and signed release policy |
| Installer / support owner / remote access | ASSUMED – pending client approval | Named client administrator; time-limited approved support access |
| Go-live date / UAT participants / scope | ASSUMED – pending client approval | UAT before go-live: join, audio/video, screen share, permissions, TURN, restricted network, AI if enabled, backup/restore |

## Approval record

Client technical owner: __________  Network owner: __________
Security/identity owner: __________  Delivery owner: __________
Answers completed on: __________  P1 approved on: __________
Exceptions and unverified requirements: __________

The continuation brief authorizes proceeding using these working assumptions. Client answers and acceptance remain pending.
