#!/usr/bin/env bash
# hanoman-remediate · SPEC-220 — remediasi SELEKTIF item AUTO. Idempoten & anti-lockout.
# via: ssh <host> 'sudo -n env ITEMS=<id,..> SSH_PORT=<p> DRY_RUN=<1|> bash -s' < remediate.sh
# Output per baris: STEP <item> <would|ok|fail> <detail>.
#   would = pratinjau (DRY_RUN=1) — TIDAK menyentuh VPS (AC-13).
#   ok|fail = hasil apply.
# Hanya item AUTO yang boleh dijalankan; item lain ditolak (AC-16). sshd divalidasi `sshd -t`
# sebelum reload; batal bila gagal (AC-15).
set -u
SSH_PORT="${SSH_PORT:-22}"
DRY="${DRY_RUN:-}"
step() { echo "STEP $1 $2 ${3:-}"; }

# ponytail: path overridable HANYA untuk test (fixture os-release); default = /etc/os-release
. "${HANOMAN_OS_RELEASE:-/etc/os-release}" 2>/dev/null || true
case "${ID:-} ${ID_LIKE:-}" in
  *debian*|*ubuntu*) FAM=deb ;;
  *rhel*|*fedora*|*centos*|*rocky*|*alma*|*opencloudos*) FAM=rhel ;;
  *) step precheck fail "distro ${ID:-unknown} tidak didukung"; exit 1 ;;
esac
pkg() { if [ "$FAM" = deb ]; then DEBIAN_FRONTEND=noninteractive apt-get -qq install -y "$@" >/dev/null 2>&1
        else dnf -q install -y "$@" >/dev/null 2>&1; fi; }

# Set AUTO = item yang boleh di-apply (cermin overrides.ts remediable=true).
AUTO="fw-b1 ids-b1 sys-b1 ker-b1 ker-b2 ker-b3 ker-b4 ker-b5 ker-i4 ker-i6 ssh-i2 ssh-i3 ssh-i5"
is_auto() { case " $AUTO " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

SYSCTL_FILE=/etc/sysctl.d/99-hanoman.conf
set_sysctl() { # key value — runtime + persist idempoten
  sysctl -w "$1=$2" >/dev/null 2>&1 || return 1
  touch "$SYSCTL_FILE"
  if grep -qE "^$1[[:space:]]*=" "$SYSCTL_FILE" 2>/dev/null; then sed -i "s|^$1[[:space:]]*=.*|$1 = $2|" "$SYSCTL_FILE"
  else echo "$1 = $2" >> "$SYSCTL_FILE"; fi
}

SSH_DROPIN=/etc/ssh/sshd_config.d/20-hanoman-compliance.conf
ssh_need_reload=""
SSH_ITEMS=""
set_sshd() { # directive value — tulis idempoten ke drop-in compliance (belum reload)
  mkdir -p /etc/ssh/sshd_config.d
  grep -qE '^Include /etc/ssh/sshd_config.d' /etc/ssh/sshd_config 2>/dev/null \
    || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
  touch "$SSH_DROPIN"
  if grep -qiE "^$1[[:space:]]" "$SSH_DROPIN" 2>/dev/null; then sed -i "s|^$1[[:space:]].*|$1 $2|I" "$SSH_DROPIN"
  else echo "$1 $2" >> "$SSH_DROPIN"; fi
  ssh_need_reload=1
}

IFS=',' read -ra SEL <<< "${ITEMS:-}"
for it in "${SEL[@]}"; do
  [ -z "$it" ] && continue
  if ! is_auto "$it"; then step "$it" fail "bukan item AUTO — remediasi manual"; continue; fi
  if [ -n "$DRY" ]; then step "$it" would "akan menerapkan $it"; continue; fi
  case "$it" in
    fw-b1)
      if [ "$FAM" = deb ]; then
        pkg ufw; ufw allow "$SSH_PORT/tcp" >/dev/null 2>&1; ufw allow 80/tcp >/dev/null 2>&1; ufw allow 443/tcp >/dev/null 2>&1
        ufw --force enable >/dev/null 2>&1 && step fw-b1 ok "ufw aktif, allow $SSH_PORT/80/443" || step fw-b1 fail "ufw gagal"
      else
        pkg firewalld; systemctl enable --now firewalld >/dev/null 2>&1
        firewall-cmd -q --permanent --add-port="$SSH_PORT/tcp"; firewall-cmd -q --permanent --add-service=http; firewall-cmd -q --permanent --add-service=https
        firewall-cmd -q --reload && step fw-b1 ok "firewalld aktif" || step fw-b1 fail "firewalld gagal"
      fi ;;
    ids-b1)
      [ "$FAM" = rhel ] && { [ "${ID:-}" = opencloudos ] && pkg epol-release || pkg epel-release; }
      if pkg fail2ban; then
        mkdir -p /etc/fail2ban/jail.d
        printf '[sshd]\nenabled = true\nbackend = systemd\nmaxretry = 3\nbantime = 1h\nfindtime = 10m\n' > /etc/fail2ban/jail.d/hanoman.conf
        systemctl enable --now fail2ban >/dev/null 2>&1 && systemctl restart fail2ban >/dev/null 2>&1 && step ids-b1 ok || step ids-b1 fail "service gagal start"
      else step ids-b1 fail "instalasi gagal"; fi ;;
    sys-b1)
      if [ "$FAM" = deb ]; then
        pkg unattended-upgrades && printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades \
          && step sys-b1 ok "unattended-upgrades" || step sys-b1 fail
      else pkg dnf-automatic && systemctl enable --now dnf-automatic.timer >/dev/null 2>&1 && step sys-b1 ok "dnf-automatic.timer" || step sys-b1 fail; fi ;;
    ker-b1) set_sysctl net.ipv4.ip_forward 0 && step ker-b1 ok || step ker-b1 fail ;;
    ker-b2) set_sysctl net.ipv4.tcp_syncookies 1 && step ker-b2 ok || step ker-b2 fail ;;
    ker-b3) set_sysctl net.ipv4.conf.all.accept_source_route 0 && step ker-b3 ok || step ker-b3 fail ;;
    ker-b4) set_sysctl net.ipv4.conf.all.accept_redirects 0 && step ker-b4 ok || step ker-b4 fail ;;
    ker-b5) set_sysctl net.ipv4.conf.all.rp_filter 1 && step ker-b5 ok || step ker-b5 fail ;;
    ker-i4) set_sysctl kernel.randomize_va_space 2 && step ker-i4 ok || step ker-i4 fail ;;
    ker-i6) set_sysctl fs.suid_dumpable 0 && step ker-i6 ok || step ker-i6 fail ;;
    ssh-i2) set_sshd ClientAliveInterval 300; set_sshd ClientAliveCountMax 2; SSH_ITEMS="$SSH_ITEMS ssh-i2" ;;
    ssh-i3) set_sshd X11Forwarding no; set_sshd AllowTcpForwarding no; SSH_ITEMS="$SSH_ITEMS ssh-i3" ;;
    ssh-i5) set_sshd MaxAuthTries 3; SSH_ITEMS="$SSH_ITEMS ssh-i5" ;;
  esac
done

# sshd: validasi SEKALI sesudah semua perubahan; anti-lockout (AC-15). Hanya saat apply.
if [ -n "$ssh_need_reload" ] && [ -z "$DRY" ]; then
  if sshd -t 2>/dev/null || /usr/sbin/sshd -t 2>/dev/null; then
    systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null
    for it in $SSH_ITEMS; do step "$it" ok "drop-in sshd diterapkan"; done
  else
    rm -f "$SSH_DROPIN"
    for it in $SSH_ITEMS; do step "$it" fail "sshd -t menolak konfigurasi — dibatalkan"; done
  fi
fi
