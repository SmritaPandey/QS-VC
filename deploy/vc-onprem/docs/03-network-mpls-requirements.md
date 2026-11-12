# MPLS and zone rules

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

Use client-reserved addresses, no overlapping subnets, symmetric return routes and client-owned VLANs. Confirm static routing or BGP with the MPLS owner. Default deny between zones and deny internet egress on both hosts and managed endpoints. Compose does not install client firewall policy.

| From → to | Port and transport | Use |
|---|---|---|
| Managed endpoints → edge | TCP 443 | HTTPS and WSS |
| Managed endpoints → media | UDP 40000–40100 | SFU media |
| Endpoints → TURN | TCP/UDP 3478 | STUN/TURN |
| TURN relay → authorized peers | UDP 49152–49200 relay allocation | Restrict relay peers to approved SFU IP |
| Endpoints → separate TURN listener | TCP 443 or 5349 | Candidate TURN/TLS, requires separate configuration |
| Edge → app | TCP 5173, 4001–4004 | Internal routing |
| App → data | TCP 5432, 6379 | Postgres, Redis |
| Recording → object store | TCP 9000 | Disabled in pilot |
| Management → hosts | TCP 22 | Restricted SSH |
| Hosts → client DNS and time | UDP/TCP 53, UDP 123 | DNS and NTP. NTS key establishment TCP 4460 if deployed |
| Hosts → SIEM | TCP 6514 candidate | TLS syslog |
| Monitoring → managed agents | UDP 161 if required | SNMPv3 only |
| App/IdP → directory | TCP 636 and 443 as applicable | Optional LDAPS and OIDC/SAML |
| Gateways → gateways | UDP 500/4500 and ESP as required | Candidate hybrid IKEv2 overlay |

Firewall request fields: ticket, source and destination CIDR, direction, protocol and ports, owner, expiry, evidence and rollback. Use split-horizon A/PTR records and client NTP. Preserve PMTUD and validate MTU through tunnel endpoints. Candidate overlay uses RFC 9370 with required ML-KEM-768 addition and authenticated gateways. Capture negotiated proposals and prove plaintext routes are blocked. The strongSwan 6.1 proposal candidate is in ../stack/overlay/swanctl.conf.template. Install only after reviewing traffic selectors, PKI, routing and fail-closed firewall policy. [strongSwan proposals](https://docs.strongswan.org/docs/latest/config/proposals.html). Verify QoS with the client, including DSCP remarking and congestion. Collect DNS, time, ping/MTR, HTTPS trust, TURN allocation and two-site call results from each segment.
