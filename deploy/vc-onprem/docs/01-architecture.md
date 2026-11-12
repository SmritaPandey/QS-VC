# Architecture

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

Use the existing Compose services as a single-node pilot. Compose preserves migrations and service images. Client-managed network boundaries and PKI are separate from container configuration.

~~~mermaid
flowchart LR
  E[Managed endpoints] --> O[Private MPLS and candidate overlay]
  O --> C[Caddy]
  O --> T[TURN and SFU]
  C --> A[Web and APIs]
  A --> D[Postgres and Redis]
  A --> T
  D --> B[Encrypted backup target]
~~~

Production HA requires room ownership, reconnect behavior, DB failover and route failover validation. Replicating Redis does not replicate in-memory room state. Keep active and standby releases isolated until restore and load tests pass.
