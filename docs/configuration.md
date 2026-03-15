# Configuration

## Config Files

| File | Location | Purpose |
|------|----------|---------|
| `blockhost.yaml` | `/etc/blockhost/` | Server keypair, public secret, admin wallet, fund manager settings |
| `web3-defaults.yaml` | `/etc/blockhost/` | Blockchain config (contracts, RPC URL, chain ID) |
| `admin-commands.json` | `/etc/blockhost/` | Admin command definitions (port knocking, etc.) |
| `addressbook.json` | `/etc/blockhost/` | Role-to-wallet mapping (admin, server, hot, dev, broker) |
| `revenue-share.json` | `/etc/blockhost/` | Revenue sharing configuration (dev/broker splits) |
| `vms.json` | `/var/lib/blockhost/` | VM database (IPs, VMIDs, NFT state) |
| `engine.json` | `/usr/share/blockhost/` | Engine manifest (identity, wizard plugin, constraints) |

## Addressbook

Role-to-wallet mapping in `/etc/blockhost/addressbook.json`:

```json
{
  "admin":  { "address": "0x..." },
  "server": { "address": "0x...", "keyfile": "/etc/blockhost/deployer.key" },
  "dev":    { "address": "0x..." },
  "broker": { "address": "0x..." }
}
```

Entries with `keyfile` can sign transactions. The `hot` entry is auto-added on first fund cycle launch.

## Revenue Sharing

Configured in `/etc/blockhost/revenue-share.json`:

```json
{
  "enabled": true,
  "total_percent": 1.0,
  "recipients": [
    { "role": "dev", "percent": 0.5 },
    { "role": "broker", "percent": 0.5 }
  ]
}
```

`recipients[].role` maps to addressbook keys (never contains addresses directly).
