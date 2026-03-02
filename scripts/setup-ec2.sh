#!/usr/bin/env bash
#
# EC2 Instance Setup Script for Agent Kanban
#
# Target: Amazon Linux 2023 (al2023), t3.large, eu-central-1
#
# Run as root on a fresh EC2 instance:
#   curl -fsSL <raw-url> | bash
#
# Or:
#   sudo bash scripts/setup-ec2.sh
#
set -euo pipefail

echo "=== Agent Kanban EC2 Setup ==="
echo "Region: eu-central-1"
echo ""

# ─── System packages ────────────────────────────────────────────

echo "[1/8] Installing system packages..."
dnf update -y
dnf install -y git gcc-c++ make jq tar gzip

# ─── Node.js 22 via nvm ────────────────────────────────────────

echo "[2/8] Installing Node.js 22 via nvm..."
export NVM_DIR="/home/agentkanban/.nvm"

# Create the agentkanban user first (noop if exists)
id -u agentkanban &>/dev/null || useradd -m -s /bin/bash agentkanban

# Install nvm as agentkanban user
sudo -u agentkanban bash -c '
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm alias default 22
  echo "Node version: $(node --version)"
'

# ─── GitHub CLI ─────────────────────────────────────────────────

echo "[3/8] Installing GitHub CLI..."
dnf install -y 'dnf-command(config-manager)'
dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
dnf install -y gh

# ─── Caddy ──────────────────────────────────────────────────────

echo "[4/8] Installing Caddy..."
dnf install -y 'dnf-command(copr)'
dnf copr enable -y @caddy/caddy
dnf install -y caddy

# ─── Claude Code CLI ───────────────────────────────────────────

echo "[5/8] Installing Claude Code CLI..."
sudo -u agentkanban bash -c '
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  npm install -g @anthropic-ai/claude-code
  echo "Claude version: $(claude --version 2>/dev/null || echo not-yet-authed)"
'

# ─── Directory structure ────────────────────────────────────────

echo "[6/8] Setting up directories..."

# App directory
mkdir -p /opt/agent-kanban
chown agentkanban:agentkanban /opt/agent-kanban

# Data directory (mount your EBS data volume at /data first!)
mkdir -p /data/agent-kanban
chown agentkanban:agentkanban /data/agent-kanban

# Worktree directory
mkdir -p /tmp/agent-kanban-worktrees
chown agentkanban:agentkanban /tmp/agent-kanban-worktrees

# Repos directory (for cloned project repos)
mkdir -p /home/agentkanban/repos
chown agentkanban:agentkanban /home/agentkanban/repos

# Config directory
mkdir -p /etc/agent-kanban

# Caddy log directory
mkdir -p /var/log/caddy

# ─── Environment file ──────────────────────────────────────────

echo "[7/8] Creating environment template..."

if [ ! -f /etc/agent-kanban/env ]; then
  cat > /etc/agent-kanban/env << 'ENVEOF'
# Agent Kanban Environment Configuration
# Edit this file, then: sudo systemctl restart agent-kanban

NODE_ENV=production
PORT=3003
DATA_DIR=/data/agent-kanban
WORKTREE_DIR=/tmp/agent-kanban-worktrees
ALLOWED_ORIGINS=https://agent-kanban.jbergs.eu

# Authentication — CHANGE THIS to a strong random key
API_KEY=CHANGE_ME_TO_A_RANDOM_SECRET

# Anthropic API key (for chat bot feature)
# ANTHROPIC_API_KEY=sk-ant-...

# GitHub App credentials (optional — for bot-attributed git operations)
# GITHUB_APP_ID=
# GITHUB_APP_PRIVATE_KEY=
# GITHUB_APP_INSTALLATION_ID=
ENVEOF
  chmod 600 /etc/agent-kanban/env
  echo "  Created /etc/agent-kanban/env — EDIT THIS before starting the service!"
else
  echo "  /etc/agent-kanban/env already exists, skipping"
fi

# ─── Systemd service ───────────────────────────────────────────

echo "[8/8] Installing systemd services..."

# Copy the service file (assumes the repo is at /opt/agent-kanban)
if [ -f /opt/agent-kanban/systemd/agent-kanban.service ]; then
  cp /opt/agent-kanban/systemd/agent-kanban.service /etc/systemd/system/
else
  echo "  WARNING: systemd service file not found at /opt/agent-kanban/systemd/"
  echo "  Deploy the app first, then re-run this step."
fi

# Copy Caddy config
if [ -f /opt/agent-kanban/caddy/Caddyfile ]; then
  cp /opt/agent-kanban/caddy/Caddyfile /etc/caddy/Caddyfile
else
  echo "  WARNING: Caddyfile not found at /opt/agent-kanban/caddy/"
fi

systemctl daemon-reload
systemctl enable caddy
systemctl enable agent-kanban 2>/dev/null || true

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Mount your EBS data volume at /data (if not already done)"
echo "  2. Edit /etc/agent-kanban/env — set API_KEY and other secrets"
echo "  3. Deploy the app to /opt/agent-kanban (via CI/CD or manual rsync)"
echo "  4. Point agent-kanban.jbergs.eu DNS to this instance's Elastic IP"
echo "  5. Start services:"
echo "       sudo systemctl start caddy"
echo "       sudo systemctl start agent-kanban"
echo "  6. Authenticate Claude Code:"
echo "       sudo -u agentkanban -i"
echo "       claude auth login"
echo "  7. Authenticate GitHub CLI:"
echo "       sudo -u agentkanban -i"
echo "       gh auth login"
echo ""
