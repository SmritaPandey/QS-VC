# Existing language connector integration

2 November 2026. Current implementation uses browser SpeechRecognition,
server-configured LibreTranslate, and browser SpeechSynthesis. Google/Whisper
adapters are not called by this meeting flow. Recognition and voices may use
browser/OS remote services; the UI requests explicit speech-sharing opt-in.

## Meeting use

Open the language control beside the microphone and camera. It is the single
entry point for speaking language, captions and translated audio; More contains
view choices and additional meeting actions. A speaker enables Share my speech as captions;
listeners independently enable Show meeting captions and choose caption language.
Original captions work without a translation server. Hear translated audio offers
only server languages and marks missing device voices unavailable. Captions and
spoken output can use different languages. Original audio lowers only during
actual TTS playback and returns afterward. Headphones remain recommended.

Final captions are room-bound and transient: at most100 server captions perroom,
cleared when the room empties or after lazy idle expiry. No database transcript
storage is implemented. Participants can still copy displayed captions; this is
not a guarantee against external recording or provider retention.

Mic mute, explicit disable, leave/session loss and actual local TTS playback stop
recognition. Unmuting/resuming can restart only an explicitly enabled recognizer.
Browser recognition may use the browser default mic, not the selected meeting
input. Intranet/offline support is not established by API presence. A local voice
is preferable but local and remote voices vary by OS/browser.

## Configure LibreTranslate

Set server-only LIBRETRANSLATE_URL to your trusted instance base URL, without
/languages or /translate suffix. Optionally set LIBRETRANSLATE_API_KEY. Restart
signaling. The server discovers /languages and allowed target pairs, then sends
only opted-in room transcripts to /translate. No browser provider keys, Google,
Whisper, MyMemory or other automatic fallbacks. Avoid exposing LibreTranslate
publicly; connect through the backend/private network. Use HTTPS for remote hosts.

A self-hosted instance must install real Argos language models. The existing
catalogue does not promise29/39/all-local-language coverage. Only installed pairs
reported by the configured service are offered. See official installation:
https://docs.libretranslate.com/guides/installation/ .

No Docker or LibreTranslate was initially installed on this development machine.
An isolated temporary Python runtime was installed at /tmp/qsvc-libretranslate,
with model data at /tmp/qsvc-libretranslate-data. English/Hindi models are running
on127.0.0.1:5005; local ignored .env points signaling to that address. Deployment
and durable model storage are separate work. To restart this development runtime:

```sh
XDG_DATA_HOME=/tmp/qsvc-libretranslate-data XDG_CACHE_HOME=/tmp/qsvc-libretranslate-cache XDG_CONFIG_HOME=/tmp/qsvc-libretranslate-config /tmp/qsvc-libretranslate/bin/libretranslate --host 127.0.0.1 --port 5005 --load-only en,hi --disable-files-translation --disable-web-ui
```

The temporary environment may be removed by the OS; this is not a production
installation. Test results must distinguish
synthetic protocol captions from actual microphone recognition and live model
translation. Never call a dictionary stub a working translation model.

## Server boundaries

captionPublish accepts finalized <=2000-character captions only from current,
unmuted members; identity/name come from server membership. Idempotent final IDs
cannot be changed. Server bounds publication, room history, translation queues,
per-peer minute/concurrency quotas, room/global concurrency and cached results.
translateCaption accepts a stored room caption ID and target, not arbitrary
untrusted text. Invalid/unconfigured providers fail visibly with original audio.

## Remaining validation

Verify actual speech on two physical devices, language-pair accuracy, TTS autoplay,
voice availability, echo behavior, selected/default mic behavior, latency and
intranet network conditions. Unit tests and synthetic text are not acoustic proof.
The current paid-only recording requirement is a separate unfinished entitlement
and storage flow; blanket demo recording disablement has not yet been replaced.

## Observed live model results

Two synthetic WebSocket participants verified room-only captions, real configured
English→Hindi translation, independent original-language output and muted-caption
denial. The actual meeting overlay rendered “बैठक कल है” from an English sentence.
A reverse “बैठक कल है।” sample produced awkward “Meeting yesterday is”; installed
language support is not a quality guarantee. No microphone speech or physical
spoken-output quality pass is claimed. Browser capture showed device voices for
English/Hindi; actual heard audio remains unverified.
