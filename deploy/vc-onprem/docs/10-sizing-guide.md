# Sizing

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

Pilot target 25 concurrent users in 5 rooms with at most 10 per room. This is a test workload. Budget SFU ingress as sum of published audio/video bitrates and egress as sum of selected subscriber layers. At 2 Mb/s measured video, a full 10-person room receiving all nine peers would need 180 Mb/s SFU video egress before protocol overhead. Measure realistic simulcast, selected layers, screen share and relay ratio. Recording storage GB/day = hours × average Mb/s × 0.45. Multiply by retention and replication and include headroom. Record p95 join time, CPU, RAM, IOPS, jitter, RTT and loss for normal and burst loads. Measure PQ handshake bytes and latency separately. GPU selection follows measured ASR/transcode throughput.
