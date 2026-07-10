#!/usr/bin/env bash
# ssh palsu (HANOMAN_SSH_BIN) — pola yang sama dengan fake-claude.sh.
# FAKE_SSH_MODE: unreachable | verify-fail | audit-fail | (kosong = sukses)
case "${FAKE_SSH_MODE:-}" in
  unreachable) echo "ssh: connect to host x port 22: Connection refused" >&2; exit 255 ;;
esac
input="$(cat)"          # stdin = isi script (kosong untuk healthcheck/verify)
last="${*: -1}"         # arg terakhir = perintah remote

# verify-fail: harden sukses, tapi koneksi verifikasi berikutnya gagal
if [ "${FAKE_SSH_MODE:-}" = "verify-fail" ] && [[ "$input" != *"hanoman-harden"* ]]; then
  echo "ssh: connect to host x port 22: Connection refused" >&2; exit 255
fi

if [[ "$last" == *"HEALTH"* ]]; then
  echo "HEALTH uptime up 3 days"; echo "HEALTH disk 42%"
  echo "HEALTH mem 512/2048MB"; echo "HEALTH load 0.1 0.2 0.3"; exit 0
fi
if [[ "$input" == *"hanoman-harden"* ]]; then
  echo "STEP precheck ok deb ssh_port=22"; echo "STEP firewall ok ufw aktif"
  echo "STEP fail2ban ok"; echo "STEP auto_updates ok"; echo "STEP ssh ok"; echo "STEP ntp ok"; exit 0
fi
if [[ "$input" == *"hanoman-audit"* ]]; then
  echo "CHECK sudo_ok pass root"; echo "CHECK os_supported pass ubuntu 24.04"
  echo "CHECK ssh_root_login pass"
  if [ "${FAKE_SSH_MODE:-}" = "audit-fail" ]; then
    echo "CHECK ssh_password_auth fail PasswordAuthentication yes"
  else
    echo "CHECK ssh_password_auth pass"
  fi
  echo "CHECK firewall pass ufw active"; echo "CHECK fail2ban pass aktif"
  echo "CHECK auto_updates pass unattended-upgrades"
  echo "CHECK ntp pass aktif"; echo "CHECK open_ports warn port publik tak terdaftar: 5432"
  echo "CHECK pending_updates pass"; exit 0
fi
exit 0   # perintah lain (mis. verify `true`)
