# QS-VC: Deployment Modes — SaaS vs Secured On-Premise

---

## 1. Executive Summary

QS-VC supports **three deployment modes** targeting fundamentally different security postures and network topologies. This document clarifies how meeting initiation, media transport, authentication, and key management differ across modes — and why the "shareable link" paradigm (Zoom/Google Meet style) applies **only to the SaaS model**.

---

## 2. Deployment Mode Comparison

| Dimension | SaaS (Cloud) | Secured On-Premise | Hybrid |
|---|---|---|---|
| **Target Customers** | SMB, Education, Startups | Banks, Govt, Defense, PSUs | Large Enterprise |
| **Network** | Public Internet + CDN | **MPLS VPN / IPSec VPN** | VPN + Cloud overflow |
| **Media Processing** | SFU (mediasoup) | **MCU + SFU** (on-premise) | Edge SFU + Cloud SFU |
| **Meeting Initiation** | **Shareable link** (URL) | **Internal directory / Calendar** | Internal + VPN-only links |
| **Authentication** | Email/password, OAuth, MFA | **Corporate SSO** (SAML/OIDC via AD/LDAP) | SSO + federated identity |
| **Data Residency** | Region-selectable cloud | **100% on-premise** (air-gapped) | Data on-prem, config in cloud |
| **Internet Required** | Yes | **No** (fully air-gapped) | Partial (cloud control plane) |
| **Media Encryption** | DTLS/SRTP + E2EE (SFrame) | DTLS/SRTP + **MPLS encryption** + E2EE | DTLS/SRTP + VPN tunnel |
| **Key Management** | Cloud Vault (HashiCorp) | **On-premise HSM** (Thales Luna) | HSM + Cloud Vault |
| **TURN/STUN** | coturn cluster (cloud) | **Not needed** (direct LAN/VPN) | Edge TURN |
| **Compliance** | SOC 2, GDPR, DPDP | **ISO 27001, IT Act, CCA** | Both |

---

## 3. Why Secured VC Does NOT Use Link Sharing

### The Zoom/Google Meet Model (SaaS)

```
User A creates meeting
    → Gets link: https://meet.example.com/QS-XXXX-XXXX
    → Shares link via email/chat/SMS
    → Anyone with the link can join (+ optional password)
    → Media flows over the PUBLIC INTERNET via SFU
```

This model works when:
- Participants may be on **different networks** (home, office, mobile)
- No centralized **identity directory** exists
- Convenience > Security (guests can join without accounts)

### The Secured VC Model (On-Premise — Banks, Govt, Defense)

```
Admin configures meeting in INTERNAL SYSTEM
    → Meeting appears in participant calendars (Outlook/Lotus)
    → Participants connect from CORPORATE ENDPOINTS only
    → Media flows over MPLS VPN / private WAN
    → MCU processes all streams within the secure perimeter
    → NO traffic ever touches the public internet
```

This model requires:
- All participants on the **same private network** (MPLS VPN)
- **Corporate identity** (Active Directory / LDAP) — no guest accounts
- **MCU** handles transcoding, recording, and composition **on-premise**
- Meeting access tied to **device certificates** + **SSO sessions**

### Key Differences

| Aspect | SaaS (Link Sharing) | Secured (Directory/Calendar) |
|---|---|---|
| **Who can join** | Anyone with the link | Only authenticated corporate users |
| **How they join** | Click a URL → browser | Corporate app → VPN → MCU |
| **Guest access** | Yes (optional) | **No** — no external participants |
| **Meeting discovery** | Link shared externally | Calendar invitation only |
| **Network path** | Public internet | Private MPLS VPN |
| **External reach** | Global (any ISP) | Corporate WAN only |

---

## 4. Media Architecture by Mode

### SaaS Mode — SFU Over Internet

```
┌──────────────┐     Public Internet      ┌──────────────┐
│ Participant A │ ─── DTLS/SRTP ─────────► │              │
│ (Home WiFi)   │                          │   SFU        │
└──────────────┘                           │ (mediasoup)  │
                                           │  Cloud       │
┌──────────────┐     Public Internet      │              │
│ Participant B │ ─── DTLS/SRTP ─────────► │              │
│ (Office LAN)  │                          └──────────────┘
└──────────────┘        ▲
                        │
                   TURN relay (coturn)
                   for NAT traversal
```

### Secured Mode — MCU Over MPLS VPN

```
┌──────────────┐     MPLS VPN / L3VPN     ┌──────────────┐
│ Endpoint A    │ ─── SRTP ──────────────► │              │
│ (Branch HQ)   │                          │   MCU        │
└──────────────┘                           │ (On-Premise) │
                                           │              │
┌──────────────┐     MPLS VPN / L3VPN     │ • Transcoding│
│ Endpoint B    │ ─── SRTP ──────────────► │ • Composition│
│ (Data Center) │                          │ • Recording  │
└──────────────┘                           │ • AI (local) │
                                           └──────────────┘
┌──────────────┐     MPLS VPN / L3VPN           │
│ Endpoint C    │ ─── SRTP ──────────────────────┘
│ (Branch Delhi)│
└──────────────┘

No TURN/STUN needed — all endpoints on same private network
No NAT traversal — direct IP connectivity within VPN
```

### Why MCU for Secured Deployments

| Feature | SFU | MCU |
|---|---|---|
| **Transcoding** | No — clients decode all streams | Yes — single composite stream to each endpoint |
| **Bandwidth** | High (N streams per client) | Low (1 stream per client) |
| **Legacy endpoints** | WebRTC only | **H.323, SIP, proprietary codecs** |
| **Recording** | Tap from SFU, composite externally | **Native composite recording** |
| **CPU on client** | High (decode N streams) | Low (decode 1 stream) |
| **Server CPU** | Low (forward only) | **High** (transcode + compose) |
| **Best for** | Small groups, modern browsers | **Large rooms, room systems, legacy devices** |

In secured environments:
- **Room systems** (Polycom, Cisco, Tandberg) use H.323/SIP → MCU bridges these
- **Bandwidth over MPLS is expensive** → MCU's single composite stream is more efficient
- **Central recording** is mandatory for compliance → MCU handles this natively
- **Device diversity** is high (desk phones, room systems, desktop apps, tablets)

---

## 5. Authentication Flow Comparison

### SaaS — Email + OAuth

```
User → Landing Page → Sign Up (email/password) or OAuth (Google/Microsoft)
    → JWT token issued
    → Click "Create Meeting" → shareable link generated
    → Share link → guest joins with just a name
```

### Secured — Corporate SSO + Device Certificate

```
User → Corporate Desktop → LDAP/AD login (Kerberos)
    → SSO session established (SAML/OIDC via Keycloak)
    → Device certificate validated (mutual TLS)
    → Calendar shows meeting → click to join
    → MCU validates: SSO token + device cert + VPN source IP
    → No external/guest access possible
```

### Authentication Layers in Secured Mode

| Layer | Implementation |
|---|---|
| **Network** | Only corporate MPLS VPN IPs can reach the MCU |
| **Device** | mTLS with device certificates (issued by internal CA) |
| **Identity** | SAML 2.0 / OIDC via corporate IdP (AD FS / Keycloak) |
| **Session** | JWT with Dilithium-5 signature, 1-hour expiry |
| **Meeting** | Per-meeting RBAC (host, participant) from directory group |

---

## 6. Meeting Lifecycle by Mode

### SaaS Meeting Lifecycle

```
1. CREATE   → User clicks "New Meeting" on web app
2. SHARE    → Meeting link copied/emailed to participants
3. JOIN     → Participants click link, enter name, join via browser
4. MEDIA    → WebRTC via SFU (public internet, TURN if needed)
5. END      → Host ends meeting
6. ARTIFACT → Recording saved to cloud S3, summary emailed
```

### Secured Meeting Lifecycle

```
1. SCHEDULE → Admin creates meeting in corporate calendar (Exchange/Lotus)
2. INVITE   → Calendar invite sent to participants (internal only)
3. JOIN     → Participants click calendar link on corporate device
              → App connects to MCU via VPN (no browser — native app)
              → SSO + device cert validated
4. MEDIA    → H.323/SIP/WebRTC via MCU (MPLS VPN, no internet)
5. END      → Meeting ends per schedule or host action
6. ARTIFACT → Recording saved to on-premise MinIO
              → Transcript saved to on-premise PostgreSQL
              → Audit log written (tamper-proof, hash-chained)
```

---

## 7. QS-VC Implementation Strategy

### What's Built (Phase 1 — Current)

The current implementation targets the **SaaS model** with:
- React web client + WebRTC SFU (mediasoup)
- JWT authentication with email/password
- Shareable meeting links
- Cloud deployment (Render + Vercel for demo)

### What's Needed for Secured Mode (Phase 2+)

| Component | Current (SaaS) | Required (Secured) |
|---|---|---|
| **MCU** | Not implemented | Jitsi Videobridge / GStreamer pipeline |
| **SIP/H.323 Gateway** | Not implemented | Obelit / Opalvoip integration |
| **LDAP/AD Integration** | Not implemented | Keycloak LDAP federation |
| **Device Certificates** | Not implemented | mTLS with internal CA |
| **Calendar Integration** | Basic scheduling API | Exchange EWS / CalDAV connector |
| **MPLS VPN Support** | Not applicable | Network configuration (customer) |
| **On-Prem Installer** | Docker Compose exists | K3s/K8s Helm charts + air-gap bundle |
| **HSM Integration** | Vault (cloud) | Thales Luna Network HSM |
| **Audit Logs** | Basic logging | Hash-chained, Merkle tree verified |

---

## 8. Summary Decision Matrix

| Question | SaaS | Secured |
|---|---|---|
| **Do we share meeting links?** | ✅ Yes | ❌ No |
| **Do we need TURN/STUN?** | ✅ Yes | ❌ No |
| **Do we use SFU or MCU?** | SFU (primarily) | MCU (primarily) |
| **Can guests join?** | ✅ Yes | ❌ No |
| **Is internet required?** | ✅ Yes | ❌ No |
| **Where is media processed?** | Cloud | On-premise |
| **Who manages infra?** | QS-VC team | Customer IT |
| **How are meetings initiated?** | Web app | Calendar / Directory |
