# QS-VC: API Structure

---

## 1. API Design Principles

| Principle | Implementation |
|---|---|
| **External API** | REST (JSON) over HTTPS with Q-TLS |
| **Internal Service-to-Service** | gRPC with protobuf (mTLS) |
| **Admin API** | GraphQL (complex queries, dashboards) |
| **Real-Time** | WebSocket + JSON-RPC 2.0 (signaling, chat) |
| **Versioning** | URI versioning: `/api/v1/`, `/api/v2/` |
| **Auth** | OAuth 2.0 + JWT (Dilithium-signed tokens) |
| **Rate Limiting** | Token bucket per API key (Redis-backed) |
| **Pagination** | Cursor-based (Relay-style) |

---

## 2. REST API — Meeting Management

### Base URL: `https://api.qsvc.io/v1`

### Authentication

```
Headers:
  Authorization: Bearer <JWT>
  X-Tenant-Id: <tenant-uuid>        (multi-tenant routing)
  X-Request-Id: <ulid>              (distributed tracing)
  X-Idempotency-Key: <uuid>         (POST/PUT idempotency)

JWT Claims (Dilithium-signed):
{
  "sub": "user-uuid",
  "tid": "tenant-uuid",
  "role": "host",
  "scopes": ["meetings:write", "recordings:read"],
  "iss": "auth.qsvc.io",
  "exp": 1705315600,
  "iat": 1705312000,
  "alg": "DILITHIUM5+EdDSA"
}
```

### Meetings API

```yaml
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MEETING LIFECYCLE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

POST   /api/v1/meetings
  # Create a new meeting (instant or scheduled)
  Request:
    {
      "title": "Q1 Planning Review",
      "type": "scheduled",           # instant | scheduled | recurring | webinar
      "scheduledStart": "2025-01-20T10:00:00+05:30",
      "scheduledEnd": "2025-01-20T11:30:00+05:30",
      "timezone": "Asia/Kolkata",
      "settings": {
        "waitingRoom": true,
        "e2ee": true,
        "password": "secure123",
        "maxParticipants": 50,
        "recording": "cloud",        # none | cloud | local | auto
        "aiCaptions": true,
        "aiTranslation": true,
        "translationLanguages": ["hi", "ta", "te", "bn"],
        "breakoutRoomsEnabled": true
      },
      "recurrence": {                 # optional, for recurring meetings
        "frequency": "weekly",
        "interval": 1,
        "daysOfWeek": ["MO", "WE"],
        "endDate": "2025-06-30"
      },
      "invitees": [
        { "email": "alice@example.com", "role": "co-host" },
        { "email": "bob@example.com", "role": "attendee" }
      ]
    }
  Response: 201
    {
      "id": "meeting-uuid",
      "meetingCode": "QS-1234-5678",
      "joinUrl": "https://meet.qsvc.io/QS-1234-5678",
      "sipUri": "sip:QS12345678@sip.qsvc.io",
      "pstnNumbers": {
        "IN": "+91-11-4000-XXXX",
        "US": "+1-646-558-XXXX"
      },
      "hostKey": "123456",
      ...
    }

GET    /api/v1/meetings/{meetingId}
  # Get meeting details

PATCH  /api/v1/meetings/{meetingId}
  # Update meeting settings

DELETE /api/v1/meetings/{meetingId}
  # Cancel/delete meeting

GET    /api/v1/meetings?status=scheduled&from=2025-01-01&to=2025-01-31&page[cursor]=xxx
  # List meetings with filtering

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MEETING ACTIONS (in-meeting control)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

POST   /api/v1/meetings/{meetingId}/start
POST   /api/v1/meetings/{meetingId}/end
POST   /api/v1/meetings/{meetingId}/lock
POST   /api/v1/meetings/{meetingId}/recording/start
POST   /api/v1/meetings/{meetingId}/recording/stop
POST   /api/v1/meetings/{meetingId}/streaming/start
  Request: { "platform": "youtube", "streamKey": "xxxx" }
POST   /api/v1/meetings/{meetingId}/streaming/stop

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PARTICIPANTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET    /api/v1/meetings/{meetingId}/participants
POST   /api/v1/meetings/{meetingId}/participants/{participantId}/admit
POST   /api/v1/meetings/{meetingId}/participants/{participantId}/mute
POST   /api/v1/meetings/{meetingId}/participants/{participantId}/unmute
POST   /api/v1/meetings/{meetingId}/participants/{participantId}/remove
PATCH  /api/v1/meetings/{meetingId}/participants/{participantId}/role
  Request: { "role": "co-host" }

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BREAKOUT ROOMS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

POST   /api/v1/meetings/{meetingId}/breakouts
  Request: {
    "rooms": [
      { "name": "Group A", "participants": ["userId1", "userId2"] },
      { "name": "Group B", "participants": ["userId3", "userId4"] }
    ],
    "autoCloseAfterMin": 15,
    "allowReturn": true
  }
GET    /api/v1/meetings/{meetingId}/breakouts
POST   /api/v1/meetings/{meetingId}/breakouts/{roomId}/move
  Request: { "participantId": "userId", "targetRoom": "roomId" }
POST   /api/v1/meetings/{meetingId}/breakouts/close-all
```

### Recordings API

```yaml
GET    /api/v1/recordings?meetingId=xxx&from=xxx&to=xxx
GET    /api/v1/recordings/{recordingId}
GET    /api/v1/recordings/{recordingId}/download
  # Returns pre-signed URL (PQC-signed, 1h TTL)
DELETE /api/v1/recordings/{recordingId}
GET    /api/v1/recordings/{recordingId}/transcript
GET    /api/v1/recordings/{recordingId}/summary
```

### Users & Admin API

```yaml
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# USER MANAGEMENT
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

POST   /api/v1/users                     # Create user
GET    /api/v1/users                     # List users (paginated)
GET    /api/v1/users/{userId}            # Get user
PATCH  /api/v1/users/{userId}            # Update user
DELETE /api/v1/users/{userId}            # Deactivate user
POST   /api/v1/users/bulk                # Bulk create (CSV/JSON)
GET    /api/v1/users/me                  # Current user profile
PATCH  /api/v1/users/me/preferences      # Update preferences

# SCIM 2.0 Provisioning (for SSO/directory sync)
GET    /scim/v2/Users
POST   /scim/v2/Users
GET    /scim/v2/Users/{id}
PUT    /scim/v2/Users/{id}
DELETE /scim/v2/Users/{id}
GET    /scim/v2/Groups

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ANALYTICS (Admin)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET    /api/v1/analytics/meetings/summary?period=7d
  Response: {
    "totalMeetings": 1234,
    "totalMinutes": 56789,
    "avgDurationMin": 35,
    "avgParticipants": 8,
    "peakConcurrentMeetings": 120,
    "avgAudioMos": 4.2,
    "aiCaptionsUsage": 0.65,
    "topQualityIssues": [...]
  }

GET    /api/v1/analytics/quality?period=30d
GET    /api/v1/analytics/usage?groupBy=department
GET    /api/v1/analytics/ai/usage

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AUDIT LOGS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET    /api/v1/audit-logs?action=meeting.join&from=xxx&to=xxx&actor=xxx
  Response: {
    "logs": [...],
    "integrityVerified": true,
    "merkleRoot": "sha3-256-hash",
    "cursor": "next-page-token"
  }
```

---

## 3. WebSocket API — Real-Time Signaling

### Connection

```
wss://signal.qsvc.io/ws?token=<JWT>&room=<meetingCode>
```

### JSON-RPC 2.0 Messages

```jsonc
// Client → Server: Join room
{
  "jsonrpc": "2.0",
  "method": "joinRoom",
  "id": 1,
  "params": {
    "roomId": "QS-1234-5678",
    "displayName": "Alice",
    "deviceCapabilities": {
      "video": { "codecs": ["VP9", "H264"], "maxWidth": 1920 },
      "audio": { "codecs": ["opus"], "sampleRate": 48000 }
    }
  }
}

// Server → Client: Room joined
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "roomId": "QS-1234-5678",
    "routerRtpCapabilities": { ... },  // mediasoup router caps
    "participants": [
      { "userId": "...", "displayName": "Bob", "producers": [...] }
    ],
    "chatHistory": [...],
    "e2eeEnabled": true,
    "e2eePublicKeys": { "Bob": "<kyber-pubkey>" }
  }
}

// Server → Client: New participant (notification)
{
  "jsonrpc": "2.0",
  "method": "newParticipant",
  "params": {
    "userId": "...",
    "displayName": "Carol",
    "role": "attendee",
    "e2eePublicKey": "<kyber-pubkey>"
  }
}

// Client → Server: Produce (publish media)
{
  "jsonrpc": "2.0",
  "method": "produce",
  "id": 2,
  "params": {
    "transportId": "transport-uuid",
    "kind": "video",
    "rtpParameters": { ... },
    "appData": { "source": "camera" }  // camera | screen | audio
  }
}

// Client → Server: Chat message
{
  "jsonrpc": "2.0",
  "method": "chatMessage",
  "id": 3,
  "params": {
    "type": "text",
    "content": "Hello everyone!",
    "e2ePayload": "<base64-encrypted>"  // if E2EE enabled
  }
}

// Server → Client: AI caption update (streaming)
{
  "jsonrpc": "2.0",
  "method": "captionUpdate",
  "params": {
    "speakerId": "userId",
    "speakerName": "Alice",
    "language": "en",
    "text": "Let's discuss the Q1 targets",
    "isFinal": true,
    "timestamp": 1705312100.5,
    "translations": {
      "hi": "आइए Q1 लक्ष्यों पर चर्चा करें",
      "ta": "Q1 இலக்குகளைப் பற்றி விவாதிப்போம்"
    }
  }
}

// Client → Server: Reaction
{
  "jsonrpc": "2.0",
  "method": "reaction",
  "id": 4,
  "params": { "emoji": "👏" }
}
```

---

## 4. gRPC — Internal Services

```protobuf
// meeting_service.proto
syntax = "proto3";
package qsvc.meeting.v1;

service MeetingService {
  rpc CreateMeeting(CreateMeetingRequest) returns (Meeting);
  rpc GetMeeting(GetMeetingRequest) returns (Meeting);
  rpc UpdateMeeting(UpdateMeetingRequest) returns (Meeting);
  rpc EndMeeting(EndMeetingRequest) returns (google.protobuf.Empty);
  rpc ListMeetings(ListMeetingsRequest) returns (ListMeetingsResponse);
  
  // Streaming: real-time participant events
  rpc WatchMeetingEvents(WatchRequest) returns (stream MeetingEvent);
}

service SFUPlacementService {
  rpc SelectNode(SelectNodeRequest) returns (SFUNode);
  rpc ReportHealth(HealthReport) returns (google.protobuf.Empty);
  rpc GetClusterStatus(google.protobuf.Empty) returns (ClusterStatus);
}

service RecordingService {
  rpc StartRecording(StartRecordingRequest) returns (Recording);
  rpc StopRecording(StopRecordingRequest) returns (Recording);
  rpc GetRecording(GetRecordingRequest) returns (Recording);
  rpc GenerateDownloadURL(DownloadURLRequest) returns (DownloadURL);
}

service AIService {
  // Streaming: continuous STT
  rpc StreamTranscription(stream AudioChunk) returns (stream TranscriptSegment);
  
  // Streaming: continuous translation
  rpc StreamTranslation(stream TextSegment) returns (stream TranslatedSegment);
  
  // Unary: post-meeting summarization
  rpc SummarizeMeeting(SummarizeRequest) returns (MeetingSummary);
  rpc ExtractActionItems(ActionItemRequest) returns (ActionItems);
}

service AuditService {
  rpc LogEvent(AuditEvent) returns (google.protobuf.Empty);
  rpc QueryLogs(QueryLogsRequest) returns (QueryLogsResponse);
  rpc VerifyIntegrity(VerifyRequest) returns (IntegrityReport);
}
```

---

## 5. Webhook API

```yaml
# Webhook events for integrations
POST /api/v1/webhooks
  Request: {
    "url": "https://customer.com/webhook",
    "events": [
      "meeting.started",
      "meeting.ended",
      "participant.joined",
      "participant.left",
      "recording.ready",
      "transcript.ready",
      "summary.ready"
    ],
    "secret": "webhook-signing-secret"
  }

# Webhook payload (HMAC-SHA256 signed)
Headers:
  X-QS-Signature: sha256=<hmac>
  X-QS-Event: meeting.ended
  X-QS-Delivery: <uuid>

Body:
{
  "event": "meeting.ended",
  "timestamp": "2025-01-15T11:30:00Z",
  "data": {
    "meetingId": "uuid",
    "title": "Q1 Planning",
    "duration": 5400,
    "participantCount": 12,
    "recordingAvailable": true
  }
}
```

---

## 6. API Rate Limits

| Tier | Rate Limit | Burst |
|---|---|---|
| **Free** | 100 req/min | 20 req/sec |
| **Standard** | 1000 req/min | 50 req/sec |
| **Enterprise** | 10000 req/min | 200 req/sec |
| **On-Prem** | Unlimited | Unlimited |

```
Response Headers:
  X-RateLimit-Limit: 1000
  X-RateLimit-Remaining: 950
  X-RateLimit-Reset: 1705312060
  Retry-After: 30          (on 429)
```
