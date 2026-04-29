# Reconciler

Runs hourly as part of the monitor polling loop (interval is engine-defined per facts §3). Ensures local state (`vms.json`) matches on-chain state. Last-run timestamp is persisted to `/var/lib/blockhost/reconcile-state.json` so the cadence survives a monitor restart.

The reconciler defers (without burning a cycle) when:
- Another reconciliation is already in flight (concurrency guard)
- A VM provisioning operation is active — detected via the presence of `/run/blockhost/provisioning.lock` (written by the provisioner during its `create` flow)

## NFT Minting Reconciliation

For each active/suspended VM where `nft_minted !== true`, queries on-chain `ownerOf(tokenId)`. If the token exists, marks it as minted locally and updates GECOS if needed. If not, logs a warning for operator attention.

## NFT Ownership Transfer Detection

When an NFT is transferred to a new wallet, the reconciler detects the ownership change and updates the VM so the new owner can authenticate:

1. Compares on-chain `ownerOf(tokenId)` with the locally stored `owner_wallet` for each active VM
2. On transfer: updates `vms.json` and calls the provisioner's `update-gecos` command to update the VM's GECOS field
3. If the GECOS update fails (VM stopped, guest agent unresponsive), retries on the next cycle via the `gecos_synced` flag

This is the sole mechanism for propagating NFT ownership changes to VMs. The PAM module authenticates against the VM's GECOS field, not the blockchain directly.

### Provisioner Command

```
getCommand("update-gecos") <vm-name> <wallet-address> --nft-id <token_id>
```

Exit 0 = GECOS updated. Exit 1 = failed (retried next cycle).

## Network Config Reconciliation

For every active VM where `network_config_synced !== true`, the reconciler invokes `blockhost-network-hook push-vm-config <vm>`. On success it sets `network_config_synced = true` via `blockhost-vmdb update-fields` (lockfile-routed). The dispatcher reads `vm-db.network_mode` and forwards to the matching plugin's `push-vm-config` command — the engine stays mode-agnostic.

The flag is initialised at VM-creation time: the SubscriptionCreated handler runs `push-vm-config` once after minting the NFT and writes the result. Failures there are non-fatal — this loop is what eventually pulls the value true (e.g. after the guest agent comes up).

Idempotent. Safe to invoke every cycle.
