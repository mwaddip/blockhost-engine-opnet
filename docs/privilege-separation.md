# Privilege Separation

The monitor service runs as the unprivileged `blockhost` user. Operations that require root are delegated to a separate **root agent daemon** (provided by `blockhost-common`) via a Unix socket at `/run/blockhost/root-agent.sock`.

## Protocol

Length-prefixed JSON: 4-byte big-endian length + JSON payload (both directions).

- Request: `{"action": "action-name", "params": {...}}`
- Response: `{"ok": true, ...}` or `{"ok": false, "error": "reason"}`

## Client

The TypeScript client (`src/root-agent/client.ts`) provides typed wrappers:

| Action | Description |
|--------|-------------|
| `iptables-open` | Add an ACCEPT rule for a port |
| `iptables-close` | Remove an ACCEPT rule for a port |
| `generate-wallet` | Generate a keypair, save key to `/etc/blockhost/<name>.key`, update addressbook |
| `addressbook-save` | Write addressbook entries to `/etc/blockhost/addressbook.json` |
| `qm-start` | Start a Proxmox VM by VMID |

## What does NOT go through the root agent

- Reading keyfiles and addressbook.json — works via group permission (`blockhost` group, mode 0640)
- ECIES decryption — `blockhost` user can read `server.key` via group permission
- VM provisioning scripts — provisioner runs as `blockhost`
- Process checks (`pgrep`) — no privilege needed

## Systemd

The monitor service (`examples/blockhost-monitor.service`) declares a dependency on `blockhost-root-agent.service` and runs with `NoNewPrivileges=true` and `ProtectSystem=strict`.
