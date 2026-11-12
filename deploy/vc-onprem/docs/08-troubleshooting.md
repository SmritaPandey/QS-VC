# Troubleshooting

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

| Symptom | First check | Recovery |
|---|---|---|
| Signature fails | Key fingerprint, version, file inventory | Quarantine staged release and request a fresh signed copy |
| No HTTPS | DNS, certificate chain, clock, listener | Correct trust or routing. Do not bypass certificate checks |
| Meeting joins without media | SFU announced IP, return route, port ranges | Validate ICE candidates and TURN peer rules |
| TCP-only network fails | Separate TURN TLS listener and client ICE URL | Record the gap. HTTPS alone does not relay media |
| DB auth failure | Restricted roles, password consistency, schema | Reconcile account setup and migrate with approved admin role |
| AI not available | Offline policy and E2EE state | Enable only reviewed local AI profile with approved models |

Share versions, health and sanitized error categories. Keep raw tokens, cookies, URLs, DB dumps and private env out of support bundles.
