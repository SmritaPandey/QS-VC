# QS-VC: AI Architecture

---

## 1. AI Engine Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        QS-VC AI ENGINE                                 │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    REAL-TIME PIPELINE (< 300ms latency)        │   │
│  │                                                                 │   │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │   │
│  │  │ Noise   │  │ Speech   │  │ Real-Time│  │ Smart Camera   │  │   │
│  │  │ Suppres.│  │ to Text  │  │ Translat.│  │ Auto-Framing   │  │   │
│  │  │ (RNNoise│  │ (Whisper │  │ (NLLB-200│  │ (MediaPipe +   │  │   │
│  │  │  + cust)│  │  Large)  │  │  + cust) │  │  custom CNN)   │  │   │
│  │  └─────────┘  └──────────┘  └──────────┘  └────────────────┘  │   │
│  │                                                                 │   │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────────────────────────┐  │   │
│  │  │ Virtual │  │ Emotion  │  │ Voice-to-Voice Translation   │  │   │
│  │  │ Backgrnd│  │ Detect.  │  │ (STT → MT → TTS pipeline)   │  │   │
│  │  │ (SegFor.│  │ (Audio + │  │                              │  │   │
│  │  │  + ONNX)│  │  Visual) │  │                              │  │   │
│  │  └─────────┘  └──────────┘  └──────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                  POST-MEETING PIPELINE (async)                  │   │
│  │                                                                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │   │
│  │  │ Meeting      │  │ Action Item  │  │ Topic Segmentation   │  │   │
│  │  │ Summarization│  │ Extraction   │  │ & Key Moments        │  │   │
│  │  │ (LLaMA 3 70B │  │ (Fine-tuned  │  │ (Custom NER +        │  │   │
│  │  │  / Mistral)  │  │  classifier) │  │  topic model)        │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Real-Time Speech-to-Text (STT)

### Model Architecture

| Component | Details |
|---|---|
| **Base Model** | OpenAI Whisper Large-v3 (1.55B params) |
| **Optimization** | Distilled to Whisper-medium (769M), INT8 quantized via ONNX |
| **Runtime** | NVIDIA Triton Inference Server with TensorRT backend |
| **Latency** | < 200ms (streaming mode with 500ms audio chunks) |
| **Languages Supported** | 99 languages including all 22 scheduled Indian languages |

### Streaming STT Pipeline

```
Audio Stream (Opus 48kHz)
       │
       ▼
┌──────────────────┐
│ Audio Preprocessor│
│ • Opus → PCM 16kHz│
│ • VAD (Voice Act.)│
│ • Chunking (500ms)│
│ • Buffer mgmt     │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Streaming Whisper Engine              │
│                                       │
│  ┌────────────────┐                   │
│  │ Encoder        │ Runs on every     │
│  │ (Transformer)  │ 500ms chunk       │
│  └───────┬────────┘                   │
│          │                            │
│  ┌───────▼────────┐                   │
│  │ Decoder        │ Incremental       │
│  │ (Autoregressive│ decoding with     │
│  │  with cache)   │ KV-cache reuse    │
│  └───────┬────────┘                   │
│          │                            │
│  ┌───────▼────────────────────────┐   │
│  │ Partial Result Handler         │   │
│  │ • Emit partial transcripts     │   │
│  │ • Speaker diarization (pyannote│   │
│  │ • Punctuation restoration      │   │
│  │ • Timestamp alignment          │   │
│  └────────────────────────────────┘   │
└──────────────────┬───────────────────┘
                   │
                   ▼
          Caption Overlay + Translation Pipeline
```

### Indian Language Optimization

```yaml
# Additional fine-tuning for Indian languages
indian_language_models:
  tier_1_languages:  # Primary support (< 150ms latency)
    - hi: "Hindi"
    - bn: "Bengali"
    - ta: "Tamil"
    - te: "Telugu"
    - mr: "Marathi"
    - gu: "Gujarati"
    - kn: "Kannada"
    - ml: "Malayalam"
    - pa: "Punjabi"
    - or: "Odia"
    - ur: "Urdu"

  tier_2_languages:  # Full support (< 300ms latency)
    - as: "Assamese"
    - bodo: "Bodo"
    - doi: "Dogri"
    - kok: "Konkani"
    - mai: "Maithili"
    - mni: "Manipuri"
    - ne: "Nepali"
    - sa: "Sanskrit"
    - sat: "Santali"
    - sd: "Sindhi"
    - ks: "Kashmiri"

  fine_tuning_data:
    - source: "AI4Bharat IndicVoices dataset (22 languages)"
    - source: "NPTEL lecture transcripts (Hindi, Tamil, Telugu)"
    - source: "All India Radio archives (multiple languages)"
    - source: "Parliamentary debate transcripts"
    - augmentation: "Accent-specific noise augmentation"
    - augmentation: "Code-switching synthesis (Hindi-English, Tamil-English)"
```

---

## 3. Real-Time Translation Engine

### Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Translation Pipeline                                                  │
│                                                                       │
│  Source Text (from STT)                                               │
│       │                                                               │
│       ▼                                                               │
│  ┌──────────────────┐                                                 │
│  │ Language Detector │ (fastText + script detection)                  │
│  │ • Auto-detect     │                                                │
│  │ • Code-switch aware│                                               │
│  └────────┬─────────┘                                                 │
│           │                                                           │
│           ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ NLLB-200 Translation Model (Meta, 3.3B params distilled to 600M)│ │
│  │                                                                  │ │
│  │ • 200 source → 200 target language pairs                        │ │
│  │ • Optimized for Indian language pairs                           │ │
│  │ • INT8 quantized on TensorRT                                    │ │
│  │ • Batch inference across all target languages simultaneously    │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│           │                                                           │
│           ├──► Target Language 1 (e.g., Hindi captions)              │
│           ├──► Target Language 2 (e.g., Tamil captions)              │
│           └──► Target Language N                                     │
│                                                                       │
│  Each participant subscribes to their preferred language channel      │
│  Translation is computed ONCE per target language, shared across       │
│  all subscribers of that language                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Voice-to-Voice Translation Pipeline

```
Speaker A (Hindi) ────────────────────────────────────────► Listener B (English)

  Audio ──► STT ──► Text (Hindi) ──► MT ──► Text (English) ──► TTS ──► Audio
  (Opus)    (Whisper) "मीटिंग कल है"  (NLLB)  "Meeting is     (VITS/   (Opus)
                                              tomorrow"      Coqui)

Latency Budget:
  STT:     200ms
  MT:       50ms
  TTS:     100ms
  Network:  50ms
  ─────────────
  Total:   400ms (acceptable for voice, with buffering strategy)

TTS Voice Cloning (optional premium feature):
  • Extract voice embedding from first 30s of speaker audio
  • Apply voice style transfer to TTS output
  • Result: translation in speaker's approximate voice
```

---

## 4. Noise Suppression

### Dual-Engine Approach

```
┌──────────────────────────────────────────────────────────────────┐
│ Noise Suppression Pipeline                                        │
│                                                                   │
│  ┌──────────────────────────────────────┐                         │
│  │ Edge-Side (runs on client device)    │                         │
│  │                                      │                         │
│  │ RNNoise (Mozilla, < 1ms latency)     │  Handles:              │
│  │ • Recurrent neural network            │  • Keyboard noise      │
│  │ • Runs in WebAssembly                 │  • Fan noise           │
│  │ • < 5% CPU on modern devices          │  • Background hum      │
│  │ • Sample-level processing             │                         │
│  └──────────────────────────────────────┘                         │
│                                                                   │
│  ┌──────────────────────────────────────┐                         │
│  │ Server-Side (AI-enhanced, optional)  │                         │
│  │                                      │                         │
│  │ Custom U-Net (spectrogram domain)    │  Handles:              │
│  │ • Trained on DNS Challenge dataset    │  • Dog barking         │
│  │ • Music suppression mode              │  • Construction noise  │
│  │ • Baby crying isolation               │  • Multiple speakers    │
│  │ • 20ms frame processing               │  • Echo cancellation   │
│  └──────────────────────────────────────┘                         │
│                                                                   │
│  Mode Selection (automatic):                                      │
│  • Low-power devices: Edge-only (RNNoise)                        │
│  • High-noise environments: Edge + Server                        │
│  • On-Prem deployment: Edge-only (no cloud dependency)           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Smart Camera & Auto-Framing

### Pipeline

```
Camera Feed (1080p/4K @ 30fps)
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Person Detection (MediaPipe BlazePose / YOLOv8-Pose)     │
│ • Face detection + body keypoints                        │
│ • < 10ms inference on GPU, < 30ms on CPU                 │
└────────────────────────┬─────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ Single   │    │ Group    │    │ Whiteboard│
  │ Person   │    │ Frame    │    │ Mode      │
  │ Tracking │    │          │    │           │
  │          │    │ Fit all  │    │ Auto-crop │
  │ Smooth   │    │ detected │    │ to board  │
  │ pan/zoom │    │ people   │    │ content   │
  │ follow   │    │ in frame │    │ + speaker │
  └──────────┘    └──────────┘    └──────────┘
        │                │                │
        └────────────────┴────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │ Virtual PTZ      │
              │ (software crop)  │
              │ • Smooth easing  │
              │ • Anti-jitter    │
              │ • Rule of thirds │
              └──────────────────┘
                         │
                         ▼
              Cropped Frame → Encoder
```

---

## 6. Meeting Summarization & Action Items

### Post-Meeting AI Pipeline

```
Meeting Recording (audio + transcript)
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 1: Transcript Cleaning                                       │
│ • Speaker diarization alignment (pyannote)                       │
│ • Filler word removal                                            │
│ • Sentence segmentation                                          │
│ • Timestamp normalization                                        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 2: Topic Segmentation                                       │
│ • TextTiling algorithm + transformer embeddings                  │
│ • Identify discussion topics and boundaries                      │
│ • Tag each segment with topic label                              │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 3: Summarization (LLaMA 3 70B / Mistral Large)             │
│ • Hierarchical summarization:                                    │
│   - Per-topic summaries                                          │
│   - Overall meeting summary                                     │
│   - Key decisions made                                           │
│ • Structured output (JSON schema enforced)                       │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 4: Action Item Extraction                                    │
│ • Fine-tuned NER model for action items                          │
│ • Extract: task, assignee, deadline, priority                    │
│ • Confidence scoring                                             │
│ • Integration: Jira, Asana, Microsoft To-Do, Google Tasks        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 5: Emotion & Sentiment Report                                │
│ • Per-speaker sentiment trajectory                               │
│ • Meeting energy score                                           │
│ • Engagement metrics (speaking time distribution)                │
│ • Highlight moments (agreement, disagreement, decisions)         │
└──────────────────────────────────────────────────────────────────┘
```

### Summarization Output Schema

```json
{
  "meetingId": "uuid",
  "title": "Q1 Planning Review",
  "date": "2025-01-15T10:00:00Z",
  "duration": "PT1H30M",
  "participants": ["Alice", "Bob", "Carol"],
  "overallSummary": "The team reviewed Q1 targets...",
  "topics": [
    {
      "title": "Budget Allocation",
      "startTime": "00:05:23",
      "endTime": "00:25:10",
      "summary": "Discussed allocating 40% to infrastructure...",
      "keyPoints": ["Increase infra budget by 15%", "Cut travel budget"],
      "decisions": ["Approved 40% infra allocation"]
    }
  ],
  "actionItems": [
    {
      "task": "Prepare revised budget spreadsheet",
      "assignee": "Bob",
      "deadline": "2025-01-22",
      "priority": "high",
      "confidence": 0.92
    }
  ],
  "sentiment": {
    "overall": "positive",
    "score": 0.72,
    "perSpeaker": {
      "Alice": { "sentiment": "positive", "speakingTimePct": 35 },
      "Bob": { "sentiment": "neutral", "speakingTimePct": 40 },
      "Carol": { "sentiment": "positive", "speakingTimePct": 25 }
    }
  }
}
```

---

## 7. AI Infrastructure

### GPU Cluster Sizing

| Workload | Model | GPU Type | GPUs per 1K concurrent streams |
|---|---|---|---|
| STT (Whisper) | Whisper-medium INT8 | NVIDIA A10G | 4 GPUs |
| Translation | NLLB-600M INT8 | NVIDIA A10G | 2 GPUs |
| TTS | VITS/Coqui | NVIDIA T4 | 3 GPUs |
| Noise Suppression | Custom U-Net | NVIDIA T4 | 1 GPU |
| Auto-Framing | YOLOv8-pose | NVIDIA T4 | 2 GPUs |
| Summarization | LLaMA 3-70B AWQ | NVIDIA A100 80GB | 2 GPUs (batch) |

### Triton Inference Server Configuration

```
# Model repository structure
model_repository/
├── whisper_encoder/
│   ├── config.pbtxt
│   └── 1/
│       └── model.plan          # TensorRT engine
├── whisper_decoder/
│   ├── config.pbtxt
│   └── 1/
│       └── model.plan
├── nllb_translation/
│   ├── config.pbtxt
│   └── 1/
│       └── model.onnx          # ONNX Runtime
├── noise_suppression/
│   ├── config.pbtxt
│   └── 1/
│       └── model.plan
├── vad/
│   ├── config.pbtxt
│   └── 1/
│       └── model.onnx
└── person_detection/
    ├── config.pbtxt
    └── 1/
        └── model.plan
```

### On-Premise AI Deployment (Air-Gapped)

```
For on-premise / air-gapped installations:

Hardware Requirements:
┌─────────────────────────────────────────────────────────┐
│ AI Appliance (1U/2U rack server)                         │
│                                                          │
│ • 2x NVIDIA A10 GPU (24GB each)                         │
│ • 64GB RAM minimum                                      │
│ • 1TB NVMe SSD (models + cache)                         │
│                                                          │
│ Supports:                                                │
│ • 500 concurrent STT streams                            │
│ • 200 concurrent translation pairs                      │
│ • All models pre-loaded (no internet required)          │
│                                                          │
│ Model Updates:                                           │
│ • USB/secure media model update packages                │
│ • Cryptographically signed model bundles                │
│ • Version-controlled model registry                     │
└─────────────────────────────────────────────────────────┘
```
