# Reconciler

Runs every 5 minutes as part of the monitor polling loop. Ensures local state (`vms.json`) matches on-chain state.

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
