#!/usr/bin/env bash
# hanoman-audit · SPEC-164 — via `ssh <host> 'sudo -n bash -s' < audit.sh`.
# Output per baris: CHECK <nama> <pass|fail|warn> <detail…> — diparsing server/src/services/vps-audit.ts.
set -u
emit() { echo "CHECK $1 $2 ${3:-}"; }

# Script sampai sini artinya ssh+bash hidup; yang diverifikasi tinggal root/sudo.
if [ "$(id -u)" = 0 ]; then emit sudo_ok pass root
else emit sudo_ok fail "bukan root — beri passwordless sudo pada user ini"; fi

# ponytail: path overridable HANYA untuk test (fixture os-release); default = /etc/os-release
. "${HANOMAN_OS_RELEASE:-/etc/os-release}" 2>/dev/null || true
FAM=""
case "${ID:-} ${ID_LIKE:-}" in
  *debian*|*ubuntu*) FAM=deb ;;
  *rhel*|*fedora*|*centos*|*rocky*|*alma*|*opencloudos*) FAM=rhel ;;
esac
if [ -n "$FAM" ]; then emit os_supported pass "${ID:-?} ${VERSION_ID:-?}"
else
  emit os_supported fail "${ID:-unknown} — hanya keluarga debian/rhel/opencloudos"
  exit 0   # check lain tak bermakna di distro asing
fi

# --- sshd: konfigurasi EFEKTIF (sshd -T), bukan berkas — drop-in & default ikut terbaca.
SSHD_T=$( (sshd -T 2>/dev/null || /usr/sbin/sshd -T 2>/dev/null) || true )
sshd_opt() { echo "$SSHD_T" | awk -v k="$1" '$1==k{print $2; exit}'; }
SSH_PORT=22
if [ -z "$SSHD_T" ]; then
  # Dua sebab: sshd tak terpasang, atau kita bukan root. Keduanya = konfigurasi tak terbaca.
  emit ssh_root_login fail "sshd -T tak terbaca (sshd tak terpasang / bukan root)"
  emit ssh_password_auth fail "sshd -T tak terbaca (sshd tak terpasang / bukan root)"
else
  v=$(sshd_opt permitrootlogin)
  # `without-password` adalah bagaimana sshd -T menormalkan `prohibit-password` (alias lama):
  # tanpa baris ini, VPS yang root-nya sudah key-only dilaporkan fail selamanya (ADR-0025 §5).
  case "$v" in
    no|prohibit-password|without-password) emit ssh_root_login pass "$v" ;;
    *) emit ssh_root_login fail "PermitRootLogin ${v:-default}" ;;
  esac
  v=$(sshd_opt passwordauthentication)
  if [ "$v" = "no" ]; then emit ssh_password_auth pass
  else emit ssh_password_auth fail "PasswordAuthentication ${v:-default}"; fi
  p=$(sshd_opt port); SSH_PORT=${p:-22}
fi

# --- firewall
if [ "$FAM" = deb ]; then
  if ufw status 2>/dev/null | grep -q "Status: active"; then emit firewall pass "ufw active"
  else emit firewall fail "ufw tidak aktif"; fi
else
  if firewall-cmd --state 2>/dev/null | grep -q running; then emit firewall pass "firewalld running"
  else emit firewall fail "firewalld tidak jalan"; fi
fi

# --- fail2ban
if systemctl is-active --quiet fail2ban 2>/dev/null; then emit fail2ban pass aktif
else emit fail2ban fail "service tidak aktif"; fi

# --- auto security update
if [ "$FAM" = deb ]; then
  if grep -qs '"1"' /etc/apt/apt.conf.d/20auto-upgrades; then emit auto_updates pass "unattended-upgrades"
  else emit auto_updates fail "unattended-upgrades belum dikonfigurasi"; fi
else
  if systemctl is-enabled --quiet dnf-automatic.timer 2>/dev/null; then emit auto_updates pass "dnf-automatic.timer"
  else emit auto_updates fail "dnf-automatic.timer tidak aktif"; fi
fi

# --- warning-level
if timedatectl show -p NTP --value 2>/dev/null | grep -qi yes; then emit ntp pass aktif
else emit ntp warn "NTP tidak aktif — timedatectl set-ntp true"; fi

# Listener publik di luar {port SSH, 80, 443}. Loopback tak dihitung.
PORTS=$(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E '^(0\.0\.0\.0|\[::\]|\*):' \
  | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | grep -vE "^(${SSH_PORT}|80|443)$" \
  | tr '\n' ',' | sed 's/,$//')
if [ -n "$PORTS" ]; then emit open_ports warn "port publik tak terdaftar: $PORTS"
else emit open_ports pass; fi

if [ "$FAM" = deb ]; then
  N=$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst.*[Ss]ecurity')
else
  N=$(dnf -q updateinfo list security 2>/dev/null | grep -c .)
fi
if [ "${N:-0}" -gt 0 ] 2>/dev/null; then emit pending_updates warn "$N security update tertunda"
else emit pending_updates pass; fi
