#!/usr/bin/env bash
# hanoman-audit · SPEC-164 — via `ssh <host> 'sudo -n bash -s' < audit.sh`.
# Output per baris: CHECK <nama> <pass|fail|warn> <detail…> — diparsing server/src/services/vps-audit.ts.
set -u
emit() { echo "CHECK $1 $2 ${3:-}"; }
emit_stack() { echo "STACK $1 $2 ${3:-}"; }  # SPEC-221 · deteksi stack app-layer (advisory)

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

# =====================================================================================
# SPEC-220 · CHECK per itemId katalog (item ber-probe). itemId = kunci kanonik katalog
# (server/src/vps/catalog). Diparsing mapToCatalog() → scoring. Legacy CHECK di atas tetap.
# =====================================================================================

# --- firewall aktif → fw-b1 (reuse deteksi FAM di atas)
if [ "$FAM" = deb ]; then
  ufw status 2>/dev/null | grep -q "Status: active" && emit fw-b1 pass || emit fw-b1 fail "ufw nonaktif"
else
  firewall-cmd --state 2>/dev/null | grep -q running && emit fw-b1 pass || emit fw-b1 fail "firewalld mati"
fi
# --- block ping/ICMP → fw-b3 (sysctl icmp_echo_ignore_all)
[ "$(sysctl -n net.ipv4.icmp_echo_ignore_all 2>/dev/null)" = 1 ] && emit fw-b3 pass || emit fw-b3 fail "ICMP echo tidak diblok"
# --- fail2ban → ids-b1
systemctl is-active --quiet fail2ban 2>/dev/null && emit ids-b1 pass || emit ids-b1 fail "fail2ban nonaktif"
# --- auto security update → sys-b1
if [ "$FAM" = deb ]; then
  grep -qs '"1"' /etc/apt/apt.conf.d/20auto-upgrades && emit sys-b1 pass || emit sys-b1 fail "unattended-upgrades belum aktif"
else
  systemctl is-enabled --quiet dnf-automatic.timer 2>/dev/null && emit sys-b1 pass || emit sys-b1 fail "dnf-automatic.timer nonaktif"
fi

# --- sshd (konfigurasi efektif via $SSHD_T / sshd_opt yang sudah didefinisikan di atas)
if [ -n "$SSHD_T" ]; then
  # ssh-b1 ganti port default
  [ "$SSH_PORT" != 22 ] && emit ssh-b1 pass "port $SSH_PORT" || emit ssh-b1 fail "masih port 22"
  # ssh-b2 disable root login
  case "$(sshd_opt permitrootlogin)" in no|prohibit-password|without-password) emit ssh-b2 pass ;; *) emit ssh-b2 fail "PermitRootLogin $(sshd_opt permitrootlogin)" ;; esac
  # ssh-b3 disable password auth
  [ "$(sshd_opt passwordauthentication)" = no ] && emit ssh-b3 pass || emit ssh-b3 fail "PasswordAuthentication $(sshd_opt passwordauthentication)"
  # ssh-i2 idle timeout (ClientAliveInterval > 0)
  cai=$(sshd_opt clientaliveinterval); [ "${cai:-0}" -gt 0 ] 2>/dev/null && emit ssh-i2 pass "ClientAliveInterval $cai" || emit ssh-i2 fail "ClientAliveInterval 0"
  # ssh-i3 X11 & TCP forwarding off
  { [ "$(sshd_opt x11forwarding)" = no ] && [ "$(sshd_opt allowtcpforwarding)" = no ]; } && emit ssh-i3 pass || emit ssh-i3 fail "X11/TCP forwarding aktif"
  # ssh-i5 MaxAuthTries <= 4
  mat=$(sshd_opt maxauthtries); [ "${mat:-6}" -le 4 ] 2>/dev/null && emit ssh-i5 pass "MaxAuthTries $mat" || emit ssh-i5 fail "MaxAuthTries ${mat:-default}"
else
  for k in ssh-b1 ssh-b2 ssh-b3 ssh-i2 ssh-i3 ssh-i5; do emit "$k" fail "sshd -T tak terbaca"; done
fi

# --- kernel sysctl → ker-*
sctl() { sysctl -n "$1" 2>/dev/null; }
[ "$(sctl net.ipv4.ip_forward)" = 0 ] && emit ker-b1 pass || emit ker-b1 fail "ip_forward=$(sctl net.ipv4.ip_forward)"
[ "$(sctl net.ipv4.tcp_syncookies)" = 1 ] && emit ker-b2 pass || emit ker-b2 fail "tcp_syncookies off"
[ "$(sctl net.ipv4.conf.all.accept_source_route)" = 0 ] && emit ker-b3 pass || emit ker-b3 fail "source_route on"
[ "$(sctl net.ipv4.conf.all.accept_redirects)" = 0 ] && emit ker-b4 pass || emit ker-b4 fail "icmp_redirects on"
[ "$(sctl net.ipv4.conf.all.rp_filter)" = 1 ] && emit ker-b5 pass || emit ker-b5 fail "rp_filter off"
[ "$(sctl kernel.randomize_va_space)" = 2 ] && emit ker-i4 pass || emit ker-i4 fail "ASLR != 2"
[ "$(sctl fs.suid_dumpable)" = 0 ] && emit ker-i6 pass || emit ker-i6 fail "suid_dumpable != 0"

# =============== SPEC-221 · deteksi stack app-layer (advisory) ===============
# STACK <section> <present|absent> <detail>. `absent` BUKAN bukti pasti — layanan bisa jalan
# di Docker yang tak terdeteksi probe bare-metal; karena itu jadi SARAN N/A, bukan auto-exclude.
has_cmd() { command -v "$1" >/dev/null 2>&1; }
# aaPanel
{ [ -d /www/server/panel ] || has_cmd bt; } && emit_stack aapanel present "aaPanel terdeteksi" \
  || emit_stack aapanel absent "tak ada /www/server/panel"
# web server
if has_cmd nginx || has_cmd apache2 || has_cmd httpd \
   || pgrep -x nginx >/dev/null 2>&1 || pgrep -x apache2 >/dev/null 2>&1 || pgrep -x httpd >/dev/null 2>&1; then
  emit_stack webserver present "nginx/apache terdeteksi"
else emit_stack webserver absent "tak ada nginx/apache (cek Docker manual)"; fi
# database
if has_cmd mysql || has_cmd mariadb || has_cmd psql \
   || pgrep -x mysqld >/dev/null 2>&1 || pgrep -x postgres >/dev/null 2>&1 \
   || ss -tlnH 2>/dev/null | grep -qE ':(3306|5432)\b'; then
  emit_stack database present "db terdeteksi"
else emit_stack database absent "tak ada mysql/postgres (cek Docker manual)"; fi
# ssl/tls
if has_cmd certbot || [ -d /etc/letsencrypt/live ]; then emit_stack ssl present "certbot/letsencrypt"
else emit_stack ssl absent "tak ada certbot"; fi
