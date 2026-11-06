# Multilingual captions, speech-to-text, transcripts and minutes

6 November 2026. Replaces the browser-only flow described in `EXISTING_LANGUAGE_CONNECTORS.md`.

## How it works

```
speaker mic (meeting track) ──16 kHz PCM──► signaling ──► services/asr (Whisper | IndicConformer)   partial + final text
                                                │
               captionReceived (original) ◄─────┤
                                                ├──► services/mt (IndicTrans2)  once per language someone chose
          captionTranslated (per language) ◄────┘
                                                └──► transcript (host opt-in) ──► meeting service DB ──► minutes (LLM)
```

- **Engines**: Whisper for English, Hindi/Hinglish and foreign languages; AI4Bharat IndicConformer for the
  other 21 scheduled Indian languages (Tamil, Bengali, Telugu, Marathi, …). Automatic detection routes
  confident Indian-language speech to IndicConformer. See `services/asr/README.md` (needs `HF_TOKEN`).
- **Speech recognition**: when `ASR_URL` is set, browsers stream the meeting microphone (the device
  picked in the meeting, after noise suppression) to signaling, which relays it to `services/asr`.
  Works in Chrome, Edge, Firefox, Safari and the desktop app; audio stays on your servers.
  If `ASR_URL` is empty, the old browser recognizer is used (Chrome/Edge; audio goes to the browser vendor).
- **Live text**: grey interim text appears while someone speaks and is replaced by the final line.
  Interim text is never stored or translated.
- **Translation**: each listener tells the server up to two languages (captions + spoken audio).
  Each final line is translated **once per language** and pushed only to those listeners.
  Provider: `LIBRETRANSLATE_URL` (point it at `services/mt` for IndicTrans2) or Google
  (`CAPTION_TRANSLATION_PROVIDER=google`, all Google languages, speaker consent required).
- **Transcript**: hosts/co-hosts turn on *Save transcript*; everyone sees “Transcript is being saved”.
  Lines are kept while the meeting runs and stored when saving stops or the meeting empties.
  Participants can download `.txt` / `.srt`. The host can download later:
  `GET /api/meetings/code/<CODE>/transcript?format=txt|srt|json`.
- **Minutes**: with `MINUTES_LLM_URL` + `MINUTES_LLM_MODEL` (any OpenAI-compatible endpoint — vLLM,
  Ollama, Azure OpenAI…), the host clicks *Create minutes*: summary, decisions, action items, open questions.

## Turn it on

1. `node db/migrate.js` (adds `014_meeting_transcripts.sql`).
2. `docker compose --profile ai up -d asr mt` (first start downloads models; GPU strongly recommended for ASR).
3. Signaling environment:
   ```
   ASR_URL=http://asr:8000
   LIBRETRANSLATE_URL=http://mt:5000
   MEETING_INTERNAL_URL=http://meeting:4003
   # optional
   MINUTES_LLM_URL=http://llm:8000/v1
   MINUTES_LLM_MODEL=<model name>
   ```
4. Redeploy signaling, meeting and web.

All limits are environment variables (see `.env.example`, `CAPTION_*`). Service details:
`services/asr/README.md`, `services/mt/README.md`.

## Security notes

- Identity on every caption comes from server membership, never from the client.
- Audio is dropped server-side whenever the server marks the speaker muted.
- Webinar audiences cannot publish captions or audio.
- The speech service, translation service and LLM should be on the private network only.
- High-frequency caption messages reuse a session check made in the last 15 s instead of calling
  the auth service per audio chunk; all other messages are still checked every time.
- E2EE meetings (when switched on) cannot use server recognition: the server must not hear audio.

## Verified here (cloud sandbox, 6 Nov 2026)

- Unit tests: signaling 97, meeting +3, web +4, `services/asr` 5, `services/mt` 4.
- End to end with the real services and **fake models** (model downloads are blocked in the sandbox):
  real Chromium captured a fake microphone through AudioWorklet → 15 × 250 ms chunks → signaling →
  `services/asr` → interim + final captions on a second client → `services/mt` → English and Tamil
  pushed only to the listeners who chose them; muted speaker produced nothing; transcript stored
  through the meeting-service endpoint.

## Still to verify on your hardware

Real model accuracy per language (WER on your own meeting audio), GPU latency under load,
two physical devices with real voices, DB migration on the production database, LLM minutes quality.
