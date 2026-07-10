#!/usr/bin/env bash
# hanoman-harden · SPEC-164 — idempotent; dijalankan HANYA lewat tombol Harden,
# via `ssh <host> 'sudo -n env SSH_PORT=<port> SSH_USER=<user> bash -s' < harden.sh`.
# Output: STEP <nama> <ok|fail> <detail…>. TIDAK membuat user, TIDAK mengganti port SSH,
# TIDAK menyentuh service custom — itu jalur sesi Claude (SPEC-164 §5).
set -u
SSH_PORT="${SSH_PORT:-22}"
step() { echo "STEP $1 $2 ${3:-}"; }

[ "$(id -u)" = 0 ] || { step precheck fail "bukan root"; exit 1; }
. /etc/os-release 2>/dev/null || true
case "${ID:-} ${ID_LIKE:-}" in
  *debian*|*ubuntu*) FAM=deb ;;
  *rhel*|*fedora*|*centos*|*rocky*|*alma*) FAM=rhel ;;
  *) step precheck fail "distro ${ID:-unknown} tidak didukung"; exit 1 ;;
esac
step precheck ok "$FAM ssh_port=$SSH_PORT"

pkg() { if [ "$FAM" = deb ]; then DEBIAN_FRONTEND=noninteractive apt-get -qq install -y "$@" >/dev/null 2>&1
        else dnf -q install -y "$@" >/dev/null 2>&1; fi; }
[ "$FAM" = deb ] && apt-get -qq update >/dev/null 2>&1

# 1 · firewall — allow port SSH DULU, baru enable (anti-lockout)
if [ "$FAM" = deb ]; then
  pkg ufw
  if ufw allow "$SSH_PORT/tcp" >/dev/null 2>&1 && ufw allow 80/tcp >/dev/null 2>&1 \
     && ufw allow 443/tcp >/dev/null 2>&1 && ufw --force enable >/dev/null 2>&1; then
    step firewall ok "ufw aktif, allow $SSH_PORT/80/443"
  else step firewall fail "ufw gagal"; fi
else
  pkg firewalld
  if systemctl enable --now firewalld >/dev/null 2>&1 \
     && firewall-cmd -q --permanent --add-port="$SSH_PORT/tcp" \
     && firewall-cmd -q --permanent --add-service=http \
     && firewall-cmd -q --permanent --add-service=https \
     && firewall-cmd -q --reload; then
    step firewall ok "firewalld aktif, allow $SSH_PORT/http/https"
  else step firewall fail "firewalld gagal"; fi
fi

# 2 · fail2ban
[ "$FAM" = rhel ] && pkg epel-release
if pkg fail2ban; then
  mkdir -p /etc/fail2ban/jail.d
  cat > /etc/fail2ban/jail.d/hanoman.conf <<'EOF'
[sshd]
enabled = true
maxretry = 3
bantime = 1h
findtime = 10m
EOF
  if systemctl enable --now fail2ban >/dev/null 2>&1 && systemctl restart fail2ban >/dev/null 2>&1; then
    step fail2ban ok
  else step fail2ban fail "service gagal start"; fi
else step fail2ban fail "instalasi gagal"; fi

# 3 · auto security update
if [ "$FAM" = deb ]; then
  if pkg unattended-upgrades; then
    printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
      > /etc/apt/apt.conf.d/20auto-upgrades
    step auto_updates ok "unattended-upgrades"
  else step auto_updates fail "instalasi gagal"; fi
else
  if pkg dnf-automatic && systemctl enable --now dnf-automatic.timer >/dev/null 2>&1; then
    step auto_updates ok "dnf-automatic.timer"
  else step auto_updates fail; fi
fi

# 4 · sshd — drop-in + sshd -t WAJIB pass sebelum reload (anti-lockout).
# User terkonfigurasi = root → prohibit-password (key-only), bukan `no`:
# `no` memutus akses hanoman sendiri (ADR-0025 §5).
#
# Nama berawalan `01-`, bukan `99-`: sshd memakai nilai PERTAMA yang ditemukan, dan
# Include memuat drop-in berurutan nama. Image cloud Ubuntu memasang
# 50-cloud-init.conf berisi `PasswordAuthentication yes` — sebuah 99-hanoman.conf
# akan dibaca sesudahnya dan diabaikan diam-diam (diverifikasi dengan sshd -T).
ROOT_LOGIN=no
[ "${SSH_USER:-}" = root ] && ROOT_LOGIN=prohibit-password
DROPIN=/etc/ssh/sshd_config.d/01-hanoman.conf
mkdir -p /etc/ssh/sshd_config.d
grep -qE '^Include /etc/ssh/sshd_config.d' /etc/ssh/sshd_config 2>/dev/null \
  || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
cat > "$DROPIN" <<EOF
PermitRootLogin $ROOT_LOGIN
PasswordAuthentication no
MaxAuthTries 3
EOF
if sshd -t 2>/dev/null || /usr/sbin/sshd -t 2>/dev/null; then
  systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null
  step ssh ok "PermitRootLogin $ROOT_LOGIN · PasswordAuthentication no"
else
  rm -f "$DROPIN"
  step ssh fail "sshd -t menolak konfigurasi — drop-in dibatalkan"
fi

# 5 · NTP
if timedatectl set-ntp true 2>/dev/null; then step ntp ok; else step ntp fail; fi
