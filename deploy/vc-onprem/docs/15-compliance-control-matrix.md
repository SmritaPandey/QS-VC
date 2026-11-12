# Compliance mapping

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

| Control / framework | Current component and evidence required | Status |
|---|---|---|
| NIST AC-2, AC-3, IA-2 / ISO A.5.15–18 | Tenant DB roles and session enforcement. Need account reviews, admin MFA and JIT tests for moderate/high baseline tailoring | Implemented-Untested |
| NIST SC-7, SC-8, SC-13 / ISO A.8.20, A.8.24 | Caddy plus client segmentation. Need per-path negotiation, firewall and key custody records | Designed |
| NIST AU-2, AU-9, AU-11 / CERT-In | Caddy structured logs. Need signed audit integrity, centralized retention and reporting drill | Gap |
| NIST CP-9, CP-10 / ISO A.8.13–14 | Restore and failover runbook. Need immutable copy and RPO/RTO evidence | Designed |
| NIST SA-15, SR-4 / ISO A.8.25, A.8.29 | Image packager and dual-signature verifier. Need artifact-specific SBOM, scans and build provenance | Implemented-Untested |
| CNSA 2.0 and SP 800-208 | Crypto architecture candidates. Need use-case transition deadlines, stateful signature controls if used and procurement review | Designed |
| FIPS 140-3 | Need CMVP certificate, exact module and approved operating environment for each required cryptographic use | Gap |
| DPDP Act and Rules | Data inventory, purpose limitation, notices, consent records, export/erasure and processor contracts. Confirm phased commencement and applicability | Designed |
| MeitY empanelment and GIGW | Confirm tender scope and assess UI accessibility and hosting requirements | Gap |

Pilot policy proposes a rolling 180 days of applicable ICT logs in India and escalation for reportable incidents within six hours of noticing or being notified. Incident lead records detection time, sends available facts through official channels and follows up with preserved evidence. Client counsel confirms obligations and phased commencement. [CERT-In directions and FAQ](https://www.cert-in.org.in/Directions70B.jsp) · [MeitY DPDP rules](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa)

Full control-by-control baseline assessment remains open. External evidence may include authorized penetration testing, STQC/GIGW, Common Criteria and CMVP where required. No certification is asserted.
