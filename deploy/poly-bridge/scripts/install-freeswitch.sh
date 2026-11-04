#!/usr/bin/env bash
# Installs FreeSWITCH 1.10 on Debian 12 (MCU host, on-prem) with the modules the bridge needs.
# Requires a free SignalWire personal access token: https://id.signalwire.com (Personal Access Tokens).
set -euo pipefail
: "${SIGNALWIRE_TOKEN:?export SIGNALWIRE_TOKEN first}"

apt-get update && apt-get install -y gnupg2 wget lsb-release
wget --http-user=signalwire --http-password="$SIGNALWIRE_TOKEN" \
  -O /usr/share/keyrings/signalwire-freeswitch-repo.gpg \
  https://freeswitch.signalwire.com/repo/deb/debian-release/signalwire-freeswitch-repo.gpg
echo "machine freeswitch.signalwire.com login signalwire password $SIGNALWIRE_TOKEN" > /etc/apt/auth.conf
chmod 600 /etc/apt/auth.conf
echo "deb [signed-by=/usr/share/keyrings/signalwire-freeswitch-repo.gpg] https://freeswitch.signalwire.com/repo/deb/debian-release/ $(lsb_release -sc) main" \
  > /etc/apt/sources.list.d/freeswitch.list
apt-get update
apt-get install -y freeswitch-meta-vanilla freeswitch-mod-conference freeswitch-mod-av \
  freeswitch-mod-vpx freeswitch-mod-opus freeswitch-mod-g723-1 freeswitch-mod-h26x \
  freeswitch-mod-sofia freeswitch-mod-event-socket

# mod_h323 is not in the binary repo on every release. Check, then build if missing.
if ! apt-get install -y freeswitch-mod-h323 2>/dev/null; then
  echo ">>> freeswitch-mod-h323 not packaged. Options:"
  echo "    a) build h323plus + ptlib and FreeSWITCH src/mod/endpoints/mod_h323 from source, or"
  echo "    b) put Poly RMX/DMA (or another H.323<->SIP gateway) in front and dial the room over SIP."
fi

for m in mod_conference mod_av mod_vpx mod_opus mod_sofia mod_event_socket mod_h323; do
  grep -q "\"$m\"" /etc/freeswitch/autoload_configs/modules.conf.xml || \
    sed -i "s#</modules>#  <load module=\"$m\"/>\n</modules>#" /etc/freeswitch/autoload_configs/modules.conf.xml
done
echo "Now copy ../freeswitch/* into /etc/freeswitch (merge the .snippet files), set the ESL password, and: systemctl restart freeswitch"
