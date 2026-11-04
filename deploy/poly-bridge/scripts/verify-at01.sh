#!/usr/bin/env bash
# AT-01 evidence collector. Run during the call with all three endpoints connected.
# Usage: ROOM=demo BRIDGE=http://10.0.0.10:4000/poly TOKEN=... ./verify-at01.sh
set -euo pipefail
ROOM=${ROOM:?}; BRIDGE=${BRIDGE:?}; TOKEN=${TOKEN:-}
OUT=at01-$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"

echo "== MCU members (expect: 1 H.323, 1 SIP Poly, uplink per browser, 1 downlink)"
fs_cli -x "conference $ROOM json_list" | tee "$OUT/mcu.json" | python3 -c '
import json,sys
for c in json.load(sys.stdin):
  for m in c["members"]:
    print(f"  {m[\"id\"]:>4} {m[\"caller_id_name\"][:28]:28} talking={m[\"flags\"].get(\"talking\")} video={m[\"flags\"].get(\"has_video\")}")'

echo "== Per-channel codecs + SRTP"
for u in $(fs_cli -x "conference $ROOM list" | cut -d';' -f3); do
  fs_cli -x "uuid_dump $u" | grep -E "^(Channel-Name|variable_rtp_use_codec_name|variable_rtp_use_video_codec_name|variable_rtp_secure_media_confirmed|variable_rtp_has_crypto):" | tee -a "$OUT/channels.txt"
  echo "--" | tee -a "$OUT/channels.txt"
done

echo "== Bridge media health (RTP both directions over 2s)"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BRIDGE/rooms/$ROOM/health" | tee "$OUT/health.json"; echo
echo "Evidence saved in $OUT/. Attach to the 'Test Log' sheet. Still confirm by eye+ear all 6 directions."
