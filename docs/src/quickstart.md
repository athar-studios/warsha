# Quickstart

Get Warsha running in 5 minutes.

## Installation

### From GitHub Releases (Recommended)

Download the latest release for your platform:

- **Linux**: `warsha-linux` + `warshad-linux`
- **macOS**: `warsha-macos` + `warshad-macos` (Apple Silicon & Intel)
- **Windows**: `warsha-windows.exe` + `warshad-windows.exe`

```bash
# Linux/macOS
curl -L -o warsha https://github.com/Warsha/Warsha/releases/latest/download/warsha-linux
chmod +x warsha
sudo mv warsha /usr/local/bin/

curl -L -o warshad https://github.com/Warsha/Warsha/releases/latest/download/warshad-linux
chmod +x warshad
sudo mv warshad /usr/local/bin/
```

### From Source

```bash
git clone https://github.com/Warsha/Warsha.git
cd Warsha
cargo install --path crates/warsha-cli --path crates/warshad
```

### Desktop App

Download the installer from [GitHub Releases](https://github.com/Warsha/Warsha/releases):

- **Windows**: `Warsha_*_x64_en-US.msi` or `Warsha_*_x64-setup.exe`
- **macOS**: `Warsha_*.dmg`
- **Linux**: `warsha_*_amd64.deb` or `warsha_*_amd64.AppImage`

## First Project

### 1. Initialize Warsha

```bash
warsha init
```

This creates `~/.config/warsha/config.toml` and the database.

### 2. Add an AI Provider

```bash
# Using OpenAI
warsha providers add openai --key sk-... --name my-openai

# Using Anthropic
warsha providers add anthropic --key sk-ant-... --name my-anthropic

# Using local Ollama
warsha providers add ollama --name local-llama
```

### 3. Create a New Project

```bash
warsha new "Build a todo app with React, TypeScript, and Vite"
```

This creates a project and starts the pipeline at the **Idea** stage.

### 4. Watch the Pipeline Run

```bash
# Follow the run live
warsha run --follow

# Or check status
warsha status
```

## Running the Pipeline

The pipeline advances through stages automatically. At each **Gate**, it pauses for your approval:

```text
Idea → Gate A → Research → PRD Spec → Gate B → Design → Plan Tasks → Code → Review/QA/Security → Gate C → Release → Gate D → Launch Drafts → Feedback
```

### Approve Gates

```bash
# List pending gates
warsha gates

# Approve Gate A
warsha approve gate_a

# Reject with reason
warsha reject gate_b --reason "PRD needs more detail"

# Request changes
warsha reject gate_c --reason "Security review needed" --changes
```

### View Artifacts

Each stage produces artifacts in the `factory/` directory:

```bash
warsha logs --follow          # Live event stream
warsha status                 # Current stage and status
```

### Check Budget

```bash
warsha budget                 # Show current spend
warsha budget set 50          # Set $50 budget
```

## Desktop App

If you installed the desktop app:

1. Launch Warsha from your applications menu
2. Complete onboarding (language, providers, GitHub)
3. Create projects visually on the kanban board
4. Approve gates with one click
5. View artifacts with syntax highlighting

## Remote PWA

Pair your mobile device:

1. Open desktop app → Devices → Pair New Device
2. Scan QR code with mobile browser
3. Approve gates, chat with agents, get push notifications

## Next Steps

- [Configure Providers](providers.md) — Add more AI providers
- [Security Model](security.md) — Understand the threat model
- [Architecture](architecture.md) — Learn how it works under the hood