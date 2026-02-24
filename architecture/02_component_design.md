# QS-VC: Component-Level Design

---

## 1. SFU Media Engine — mediasoup

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│ mediasoup Worker (C++ core, Node.js control)               │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Router (per meeting room)                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │ WebRtcTrans  │  │ WebRtcTrans │  │ PlainTrans  │  │  │
│  │  │ (User A)     │  │ (User B)    │  │ (Recording) │  │  │
│  │  │  ┌────────┐  │  │  ┌────────┐ │  │             │  │  │
│  │  │  │Producer│  │  │  │Consumer│ │  │             │  │  │
│  │  │  │(cam,mic│  │  │  │(recv A)│ │  │             │  │  │
│  │  │  │,screen)│  │  │  │        │ │  │             │  │  │
│  │  │  └────────┘  │  │  └────────┘ │  │             │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  Scaling: 1 Worker per CPU core, 1 Router per room         │
│  Cascade: Router.pipeToRouter() for multi-node rooms       │
└────────────────────────────────────────────────────────────┘
```

### Simulcast Configuration

```javascript
// Client-side simulcast encoding parameters
const simulcastEncodings = [
  { rid: 'r0', maxBitrate: 100_000,  scaleResolutionDownBy: 4, maxFramerate: 15 },  // Low (180p)
  { rid: 'r1', maxBitrate: 500_000,  scaleResolutionDownBy: 2, maxFramerate: 30 },  // Medium (360p)
  { rid: 'r2', maxBitrate: 2_500_000, scaleResolutionDownBy: 1, maxFramerate: 30 }, // High (720p)
];

// Server-side layer selection per consumer
// Driven by: receiver bandwidth, active speaker, gallery view position
function selectLayer(consumer, receiverBandwidth, isActiveSpeaker) {
  if (isActiveSpeaker && receiverBandwidth > 2_000_000) {
    consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  } else if (receiverBandwidth > 500_000) {
    consumer.setPreferredLayers({ spatialLayer: 1, temporalLayer: 2 });
  } else {
    consumer.setPreferredLayers({ spatialLayer: 0, temporalLayer: 1 });
  }
}
```

### SFU Cascade for Large Meetings

```
┌─────────────┐     Pipe Transport     ┌─────────────┐
│ SFU Node 1  │◄───────────────────────►│ SFU Node 2  │
│ (Users 1-50)│     (mediasoup pipe)    │ (Users 51-100)
└──────┬──────┘                         └──────┬──────┘
       │            Pipe Transport             │
       └──────────────────┬────────────────────┘
                          ▼
                   ┌─────────────┐
                   │ SFU Node 3  │
                   │ (Users 101+ │
                   │  + Recording)
                   └─────────────┘

Cascade Coordination via Redis PubSub:
- Room membership registry
- Producer announcement broadcasts
- Bandwidth aggregation metrics
```

---

## 2. Signaling Server

### Protocol: JSON-RPC 2.0 over WebSocket

```
Client                    Signaling Server              SFU
  │                            │                         │
  │──── joinRoom ─────────────►│                         │
  │                            │──── createRouter() ────►│
  │                            │◄─── routerCapabilities ─│
  │◄─── routerRtpCapabilities ─│                         │
  │                            │                         │
  │──── createTransport ──────►│                         │
  │                            │──── createWebRtcTransport()
  │◄─── transportParams ───────│◄─── transportParams ────│
  │                            │                         │
  │──── connectTransport ─────►│                         │
  │     (dtlsParameters)       │──── transport.connect()─►│
  │                            │                         │
  │──── produce ──────────────►│                         │
  │     (kind, rtpParameters)  │──── transport.produce()─►│
  │◄─── producerId ────────────│◄─── producer ───────────│
  │                            │                         │
  │                            │──── newProducer (broadcast to others)
  │                            │                         │
  │──── consume ──────────────►│                         │
  │     (producerId)           │──── transport.consume()─►│
  │◄─── consumerParams ────────│◄─── consumer ───────────│
```

### Signaling Message Types

```typescript
// Core signaling messages
enum SignalType {
  // Room management
  JOIN_ROOM = 'joinRoom',
  LEAVE_ROOM = 'leaveRoom',
  ROOM_INFO = 'roomInfo',

  // Media negotiation
  CREATE_TRANSPORT = 'createWebRtcTransport',
  CONNECT_TRANSPORT = 'connectTransport',
  PRODUCE = 'produce',
  CONSUME = 'consume',
  RESUME_CONSUMER = 'resumeConsumer',
  PAUSE_CONSUMER = 'pauseConsumer',

  // Meeting control
  MUTE_PARTICIPANT = 'muteParticipant',
  KICK_PARTICIPANT = 'kickParticipant',
  RAISE_HAND = 'raiseHand',
  SET_SPEAKER = 'setActiveSpeaker',
  START_RECORDING = 'startRecording',
  STOP_RECORDING = 'stopRecording',

  // Collaboration
  CHAT_MESSAGE = 'chatMessage',
  WHITEBOARD_STROKE = 'whiteboardStroke',
  REACTION = 'reaction',
  POLL_CREATE = 'pollCreate',
  POLL_VOTE = 'pollVote',

  // AI
  CAPTION_UPDATE = 'captionUpdate',
  TRANSLATION_UPDATE = 'translationUpdate',
  AI_SUMMARY_REQUEST = 'aiSummaryRequest',

  // Breakout
  BREAKOUT_CREATE = 'breakoutCreate',
  BREAKOUT_ASSIGN = 'breakoutAssign',
  BREAKOUT_MOVE = 'breakoutMove',
  BREAKOUT_CLOSE = 'breakoutClose',
}

// WebSocket connection with reconnection
interface SignalingConfig {
  url: string;                    // wss://signal.qsvc.io
  reconnectInterval: 1000;        // ms
  maxReconnectAttempts: 10;
  heartbeatInterval: 5000;        // ms
  authToken: string;              // JWT with PQC signature
  roomId: string;
  userId: string;
  deviceId: string;
}
```

---

## 3. TURN/STUN/ICE Infrastructure

### Deployment Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                     GeoDNS (Anycast)                            │
│                  turn.qsvc.io → nearest PoP                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │
    ┌─────────────────────┼─────────────────────┐
    ▼                     ▼                     ▼
┌──────────┐       ┌──────────┐          ┌──────────┐
│ India PoP│       │ US PoP   │          │ EU PoP   │
│ ──────── │       │ ──────── │          │ ──────── │
│ coturn   │       │ coturn   │          │ coturn   │
│ cluster  │       │ cluster  │          │ cluster  │
│ (4 nodes)│       │ (4 nodes)│          │ (4 nodes)│
│          │       │          │          │          │
│ Protocols│       │ Protocols│          │ Protocols│
│ • STUN   │       │ • STUN   │          │ • STUN   │
│ • TURN/  │       │ • TURN/  │          │ • TURN/  │
│   UDP    │       │   UDP    │          │   UDP    │
│ • TURN/  │       │ • TURN/  │          │ • TURN/  │
│   TCP    │       │ • TURN/  │          │   TCP    │
│ • TURN/  │       │   TCP    │          │ • TURN/  │
│   TLS    │       │ • TURN/  │          │   TLS    │
│          │       │   TLS    │          │          │
│ Ports:   │       │          │          │ Ports:   │
│ 3478/UDP │       │          │          │ 3478/UDP │
│ 5349/TLS │       │          │          │ 5349/TLS │
│ 443/TLS  │       │ (same)   │          │ 443/TLS  │
└──────────┘       └──────────┘          └──────────┘
```

### coturn Configuration

```bash
# /etc/turnserver.conf (production)
listening-port=3478
tls-listening-port=5349
alt-tls-listening-port=443
relay-device=eth0
min-port=49152
max-port=65535
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=${TURN_SECRET}  # rotated hourly via Vault
realm=turn.qsvc.io
cert=/etc/ssl/turn/fullchain.pem
pkey=/etc/ssl/turn/privkey.pem
cipher-list="ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384"
no-cli
no-tcp-relay
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
total-quota=12000
bps-capacity=0
stale-nonce=600
max-bps=3000000
no-multicast-peers
```

### ICE Candidate Gathering Strategy

```typescript
const iceConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.qsvc.io:3478' },
    {
      urls: [
        'turn:turn.qsvc.io:3478?transport=udp',
        'turn:turn.qsvc.io:3478?transport=tcp',
        'turns:turn.qsvc.io:5349?transport=tcp',
        'turns:turn.qsvc.io:443?transport=tcp',  // firewall bypass
      ],
      username: dynamicUsername,      // HMAC-based, time-limited
      credential: dynamicCredential,  // from auth service
    },
  ],
  iceTransportPolicy: 'all',         // 'relay' for air-gapped
  iceCandidatePoolSize: 2,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};
```

---

## 4. Meeting Orchestrator Service (Go)

### Core Responsibilities

```
┌──────────────────────────────────────────────────┐
│ Meeting Orchestrator (Go microservice)            │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ Room Lifecycle Manager                      │  │
│  │ • Create / Destroy rooms                    │  │
│  │ • Participant admission (lobby, waiting)    │  │
│  │ • Host controls (mute all, lock, etc.)      │  │
│  │ • Meeting duration enforcement              │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ SFU Placement Engine                        │  │
│  │ • Geo-aware SFU node selection              │  │
│  │ • Load balancing across SFU cluster         │  │
│  │ • Cascade topology computation              │  │
│  │ • Failover routing                          │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ Breakout Room Manager                       │  │
│  │ • Sub-room creation on same/different SFU   │  │
│  │ • Participant assignment/movement           │  │
│  │ • Timer & auto-close                        │  │
│  │ • Broadcast to all breakouts                │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ QoS Monitor                                 │  │
│  │ • Per-participant quality metrics           │  │
│  │ • Automatic layer switching triggers        │  │
│  │ • Network quality scoring (1-5, Zoom-style) │  │
│  │ • Alert generation for degraded quality     │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ Recording Coordinator                       │  │
│  │ • Trigger server-side composite recording   │  │
│  │ • Manage active speaker recording           │  │
│  │ • Gallery view recording                    │  │
│  │ • Store to S3/MinIO with PQC encryption     │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### SFU Placement Algorithm

```go
// placement.go
type SFUNode struct {
    ID          string
    Region      string
    Latitude    float64
    Longitude   float64
    CPUUsage    float64   // 0.0 - 1.0
    BWUsage     float64   // 0.0 - 1.0
    ActiveRooms int
    MaxRooms    int
    Health      HealthStatus
}

func SelectSFUNode(participants []Participant, nodes []SFUNode) *SFUNode {
    // 1. Filter healthy nodes with capacity
    candidates := filterHealthy(nodes)
    candidates = filterHasCapacity(candidates)
    
    // 2. Compute geographic centroid of participants
    centroid := computeCentroid(participants)
    
    // 3. Score each candidate
    type scored struct {
        node  *SFUNode
        score float64
    }
    var scored_nodes []scored
    
    for _, n := range candidates {
        geoScore := 1.0 / (1.0 + haversineDistance(centroid, n.Latitude, n.Longitude))
        loadScore := 1.0 - (0.6*n.CPUUsage + 0.4*n.BWUsage)
        capacityScore := float64(n.MaxRooms-n.ActiveRooms) / float64(n.MaxRooms)
        
        // Weighted composite score
        score := 0.4*geoScore + 0.35*loadScore + 0.25*capacityScore
        scored_nodes = append(scored_nodes, scored{&n, score})
    }
    
    // 4. Select highest scoring node
    sort.Slice(scored_nodes, func(i, j int) bool {
        return scored_nodes[i].score > scored_nodes[j].score
    })
    
    return scored_nodes[0].node
}
```

---

## 5. Recording & Streaming Service

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Recording Pipeline                                           │
│                                                              │
│  SFU Media ──► PlainRtpTransport ──► GStreamer Pipeline       │
│                                       │                      │
│                           ┌───────────┴───────────┐          │
│                           ▼                       ▼          │
│                    ┌──────────────┐         ┌──────────────┐ │
│                    │ Composite    │         │ Individual   │ │
│                    │ Recording    │         │ Tracks       │ │
│                    │ (MP4 H.264   │         │ (WebM/MKV    │ │
│                    │  + AAC)      │         │  per user)   │ │
│                    └──────┬───────┘         └──────┬───────┘ │
│                           │                        │         │
│                           ▼                        ▼         │
│                    ┌──────────────────────────────────┐      │
│                    │ Post-Processing Pipeline          │      │
│                    │ • Transcode to MP4/WebM           │      │
│                    │ • Generate thumbnails             │      │
│                    │ • Extract audio for AI pipeline   │      │
│                    │ • PQC-encrypt at rest             │      │
│                    │ • Upload to S3/MinIO              │      │
│                    └──────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Live Streaming Pipeline

```
SFU ──► GStreamer (compose) ──► RTMP ──► Media Server (Nginx-RTMP)
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                              HLS Packager         DASH Packager
                              (4s segments)        (4s segments)
                                    │                   │
                                    └─────────┬─────────┘
                                              ▼
                                         CDN (Global)
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                              Web Players         Mobile Players
                              (hls.js/            (ExoPlayer/
                               dash.js)            AVPlayer)
```

---

## 6. Collaboration Services

### Chat Service (Node.js + Redis Streams)

```typescript
interface ChatMessage {
  id: string;              // ULID (time-ordered)
  roomId: string;
  senderId: string;
  type: 'text' | 'file' | 'reaction' | 'system';
  content: string;
  replyTo?: string;        // thread support
  mentions: string[];
  attachments: FileRef[];
  timestamp: number;
  encrypted: boolean;      // E2EE flag
  e2ePayload?: string;     // PQC-encrypted content
}

// Storage: Redis Streams (real-time) + PostgreSQL (persistence)
// Pattern: Write to Redis Stream → async persist to PostgreSQL
// Sync: On reconnect, client provides last message ID, server replays from stream
```

### Whiteboard Service (CRDT-Based)

```
┌──────────────────────────────────────────────────────┐
│ Whiteboard Engine                                     │
│                                                       │
│  Client A          Server (Yjs + HocusPocus)          │
│  ┌──────────┐     ┌────────────────────────┐          │
│  │ Yjs Doc  │◄───►│ Awareness Protocol     │          │
│  │ (local)  │     │ (cursor positions,     │          │
│  │          │     │  user presence)         │          │
│  │ Strokes  │     │                        │          │
│  │ Shapes   │     │ Y.Doc (authoritative)  │          │
│  │ Text     │     │ • CRDT merge           │          │
│  │ Images   │     │ • Conflict-free sync   │          │
│  └──────────┘     │ • Persistent snapshot   │          │
│                   └────────────────────────┘          │
│  Client B                                             │
│  ┌──────────┐     Rendering: Canvas API + WebGL       │
│  │ Yjs Doc  │     Export: SVG, PNG, PDF               │
│  │ (local)  │                                         │
│  └──────────┘                                         │
└──────────────────────────────────────────────────────┘
```

---

## 7. SIP/H.323 Gateway

### Interoperability Bridge

```
┌──────────────────────────────────────────────────────────────────┐
│ SIP/H.323 Gateway (FreeSWITCH + custom bridge)                   │
│                                                                   │
│  Legacy Device                    QS-VC Meeting                   │
│  (Polycom/Cisco)                                                  │
│       │                                                           │
│       │ SIP INVITE                                                │
│       ▼                                                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐│
│  │ SIP Proxy    │───►│ Transcoding  │───►│ WebRTC Bridge        ││
│  │ (Obelit/     │    │ Engine       │    │                      ││
│  │  FreeSWITCH) │    │              │    │ • SDP translation    ││
│  │              │    │ H.264 ↔ VP9  │    │ • ICE negotiation    ││
│  │ • SIP/TLS    │    │ G.711 ↔ Opus │    │ • SRTP ↔ SDES       ││
│  │ • SIP/TCP    │    │ H.263 ↔ AV1  │    │ • DTLS termination   ││
│  │ • H.323/TCP  │    │              │    │                      ││
│  └──────────────┘    └──────────────┘    └──────────────────────┘│
│                                                                   │
│  Supported Devices:                                               │
│  • Polycom Group Series, RealPresence, Trio, Studio              │
│  • Cisco SX/MX/Room Series, Webex Board                         │
│  • Yealink Meeting Bar, VC Series                                │
│  • Lifesize Icon Series                                          │
│  • Any standards-compliant SIP/H.323 endpoint                   │
│                                                                   │
│  PSTN Integration:                                                │
│  • SIP trunk to PSTN provider (Twilio/Telnyx/local ISP)         │
│  • IVR for dial-in meeting join                                  │
│  • DTMF control (mute/*6, raise hand/*9)                        │
│  • Phone participant management                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 8. Admin & Control Center

### Dashboard Components

```
┌─────────────────────────────────────────────────────────────────┐
│ ADMIN CONTROL CENTER                                             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ REAL-TIME OPERATIONS                                        │ │
│  │ • Active meetings map (global)                              │ │
│  │ • Participant count (live)                                  │ │
│  │ • SFU node health matrix                                   │ │
│  │ • TURN relay utilization                                    │ │
│  │ • Media quality heatmap (MOS scores)                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ USER & LICENSE MANAGEMENT                                   │ │
│  │ • User provisioning (SCIM 2.0)                             │ │
│  │ • Role-based access (Admin/Host/User/Guest)                │ │
│  │ • License allocation (per-seat, per-room, concurrent)      │ │
│  │ • SSO configuration (SAML 2.0, OIDC)                      │ │
│  │ • Device enrollment & management                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ ANALYTICS & REPORTING                                       │ │
│  │ • Meeting usage trends                                      │ │
│  │ • Quality of Experience (QoE) reports                       │ │
│  │ • Bandwidth consumption reports                             │ │
│  │ • AI feature adoption metrics                               │ │
│  │ • Compliance & audit reports                                │ │
│  │ • SLA compliance dashboard                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ SECURITY CENTER                                              │ │
│  │ • PQC certificate management                                │ │
│  │ • Encryption key lifecycle monitoring                       │ │
│  │ • Tamper-proof audit log viewer                             │ │
│  │ • Threat detection alerts                                   │ │
│  │ • Data residency compliance status                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```
