# Blockhost Engine (OPNet)

Blockchain-based VM hosting subscription system on Bitcoin L1. Users purchase subscriptions on-chain, which triggers automatic VM provisioning with NFT-based SSH authentication.

## How It Works

1. **User visits signup page** — Connects wallet, signs message, purchases subscription
2. **Smart contract emits event** — SubscriptionCreated with encrypted user data
3. **Monitor service detects event** — Triggers VM provisioning via pluggable provisioner
4. **VM is created** — With web3-only SSH authentication (no passwords, no keys)
5. **NFT is minted** — Contains encrypted connection details for the owner
6. **User authenticates** — Signs with wallet on VM's signing page, gets SSH access

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Signup Page   │────>│  Smart Contract  │────>│  Monitor Svc    │
│   (static HTML) │     │  (OPNet/BTC L1)  │     │  (TypeScript)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          v
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User's VM     │<────│  Provisioner     │<────│  Engine         │
│   (web3 auth)   │     │  (pluggable)     │     │  (manifest)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

The engine discovers provisioner commands via a manifest file. VMs are identified by name (`blockhost-001`), not by backend-specific IDs. Different provisioner backends can be used without engine changes.

## Components

| Component | Language | Description |
|-----------|----------|-------------|
| `contracts/` | AssemblyScript | Subscription + NFT contracts (compiled to WASM) |
| `src/monitor/` | TypeScript | Blockchain event watcher |
| `src/handlers/` | TypeScript | Event handlers (VM provisioning, NFT minting) |
| `src/admin/` | TypeScript | On-chain admin commands (port knocking, etc.) |
| `src/reconcile/` | TypeScript | NFT state reconciliation and ownership transfer detection |
| `src/fund-manager/` | TypeScript | Automated fund withdrawal, revenue sharing, gas management |
| `src/bw/` | TypeScript | blockwallet CLI for scriptable wallet operations |
| `src/ab/` | TypeScript | Addressbook CLI for managing wallet entries |
| `src/is/` | TypeScript | Identity predicate CLI (NFT ownership, contract checks) |
| `src/auth-svc/` | TypeScript | Web3 auth signing server (esbuild-bundled for VMs) |
| `src/root-agent/` | TypeScript | Client for the privileged root agent daemon |
| `blockhost/engine_opnet/` | Python | Installer wizard plugin |
| `auth-svc/signing-page/` | HTML/JS | Signing page template + engine bundle |
| `scripts/` | TS/JS/Python/Bash | Deployment, signup page, server init |

## Prerequisites

- Node.js 22+
- Python 3.10+
- OPNet contract deployment tools (`@btc-vision/transaction`)
- `blockhost-common` package (shared configuration)
- A provisioner package (e.g. `blockhost-provisioner-proxmox`) with a manifest

## Quick Start

```bash
# Clone and install
git clone https://github.com/mwaddip/blockhost-engine-opnet.git
cd blockhost-engine-opnet
npm install

# Configure
cp examples/env.example .env
# Edit .env with your deployer private key and RPC URL

# Deploy contracts
blockhost-deploy-contracts both

# Initialize server
sudo ./scripts/init-server.sh

# Generate signup page
blockhost-generate-signup --output /var/www/signup.html

# Start monitor
npm run monitor
```

## Development

```bash
npx tsc --noEmit          # Type-check TypeScript
npm run monitor            # Run event monitor
npx asc src/index.ts --config asconfig.json  # Build contracts (from contract dir)
```

## Project Structure

```
blockhost-engine-opnet/
├── contracts/                      # OPNet smart contracts (AssemblyScript → WASM)
│   ├── blockhost-subscriptions/    # Subscription management contract
│   ├── access-credential-nft/      # NFT access credentials contract
│   ├── test-token/                 # Test OP_20 token
│   └── deploy/                     # Contract deployment scripts
├── scripts/                        # Deployment & utility scripts
│   ├── deploy-contracts            # Contract deployer
│   ├── mint_nft                    # NFT minter
│   ├── generate-signup-page        # Signup page generator
│   ├── signup-template.html        # Signup page template (replaceable HTML/CSS)
│   └── signup-engine.js            # Signup page engine bundle
├── blockhost/engine_opnet/         # Installer wizard plugin
│   ├── wizard.py                   # Blueprint, API routes, finalization steps
│   └── templates/engine_opnet/     # Wizard page templates
├── engine.json                     # Engine manifest
├── src/                            # TypeScript source
│   ├── monitor/                    # Blockchain event monitor
│   ├── handlers/                   # Event handlers
│   ├── admin/                      # On-chain admin commands
│   ├── reconcile/                  # NFT reconciliation
│   ├── fund-manager/               # Fund withdrawal & distribution
│   ├── crypto.ts                   # ECIES + SHAKE256
│   ├── bhcrypt.ts                  # bhcrypt CLI
│   ├── bw/                         # blockwallet CLI
│   ├── ab/                         # addressbook CLI
│   ├── is/                         # identity predicate CLI
│   ├── auth-svc/                   # Web3 auth signing server
│   └── root-agent/                 # Root agent client
├── auth-svc/                       # Auth service assets
│   └── signing-page/               # template.html + engine.js → index.html
├── docs/                           # Detailed documentation
└── examples/                       # Deployment examples
```

## Documentation

| Document | Contents |
|----------|----------|
| [docs/smart-contract.md](docs/smart-contract.md) | Contract details, key functions, events |
| [docs/vm-authentication.md](docs/vm-authentication.md) | Auth flow, auth-svc, template package |
| [docs/reconciler.md](docs/reconciler.md) | NFT reconciliation, ownership transfer detection |
| [docs/configuration.md](docs/configuration.md) | Config files, addressbook, revenue sharing |
| [docs/fund-manager.md](docs/fund-manager.md) | Fund cycles, gas checks, hot wallet |
| [docs/cli.md](docs/cli.md) | bw, ab, is — all three CLIs |
| [docs/engine-manifest.md](docs/engine-manifest.md) | engine.json schema, constraints, theming |
| [docs/privilege-separation.md](docs/privilege-separation.md) | Root agent protocol, client actions |
| [docs/templating.md](docs/templating.md) | Page templates, customization guide |

## License

MIT

## Related Packages

- `blockhost-common` — Shared configuration and Python modules
- `blockhost-provisioner-proxmox` — VM provisioning (Proxmox)
- `blockhost-provisioner-libvirt` — VM provisioning (libvirt/KVM)
- `libpam-web3` — PAM module for web3 authentication (installed on VMs)
