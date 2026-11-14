#!/usr/bin/env bash
# QS-VC appliance console menu (tty1, first boot): network, administrator account, then QS-VC Server Setup.
set -uo pipefail
T="QS-VC Server Appliance"
# Remove the image build account and its sudo rule before anything else.
userdel -r qsvcbuild 2>/dev/null; rm -f /etc/sudoers.d/90-qsvcbuild
ip4() { ip -4 -o addr show scope global | awk '{print $2": "$4}' | paste -sd' ' -; }
while true; do
  choice=$(whiptail --title "$T" --nocancel --menu "Welcome. Configure this appliance in order.\n\nCurrent address: $(ip4)\nHostname: $(hostname)" 20 76 7 \
    1 "Network: IP address, gateway, DNS (recommended: static)" \
    2 "Hostname" \
    3 "Time server (NTP)" \
    4 "Console administrator password (for maintenance logins)" \
    5 "Install QS-VC (opens the setup wizard)" \
    6 "Enable SSH for maintenance" \
    7 "Power off" 3>&1 1>&2 2>&3)
  case "$choice" in
    1) nmtui-edit; nmcli connection reload; nmcli networking off; nmcli networking on; sleep 3 ;;
    2) h=$(whiptail --title "$T" --inputbox "Hostname (FQDN, e.g. vc.example.gov.in)" 10 70 "$(hostname)" 3>&1 1>&2 2>&3) && hostnamectl set-hostname "$h" ;;
    3) s=$(whiptail --title "$T" --inputbox "NTP server(s), space separated" 10 70 "" 3>&1 1>&2 2>&3) && { sed -i '/^server \|^pool /d' /etc/chrony.conf; for x in $s; do echo "server $x iburst" >> /etc/chrony.conf; done; systemctl restart chronyd; } ;;
    4) id qsvcadmin >/dev/null 2>&1 || useradd -m -G wheel qsvcadmin; passwd qsvcadmin; chage -d 0 qsvcadmin ;;
    5) if bash /opt/qsvc-appliance/qsvc-server-setup.run; then mkdir -p /etc/qsvc; touch /etc/qsvc/appliance-configured
         whiptail --title "$T" --msgbox "QS-VC is installed. Log in as qsvcadmin for maintenance (qsvc status)." 10 70; exit 0; fi
       read -r -p "Setup did not finish. Press Enter to return to the menu…" _ ;;
    6) ssh-keygen -A >/dev/null; systemctl enable --now sshd; firewall-cmd -q --permanent --add-service=ssh; firewall-cmd -q --reload
       whiptail --title "$T" --msgbox "SSH enabled. Log in as qsvcadmin (set the password with option 4 first)." 10 70 ;;
    7) systemctl poweroff ;;
  esac
done
