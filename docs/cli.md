# CLI Tools

## bw (blockwallet)

Scriptable wallet operations. Reads config from `web3-defaults.yaml`.

```bash
bw send <amount> <token> <from> <to>       # Send tokens between wallets
bw balance <role> [token]                   # Show wallet balances
bw split <amount> <token> <ratios> <from> <to1> <to2> ...  # Split tokens
bw withdraw [token] <to>                    # Withdraw from contract
bw swap <amount> <from-token> btc <wallet>  # Swap token for BTC
bw who <identifier>                        # Query NFT owner by token ID or 'admin'
bw who <message> <signature>               # Recover signer address from signature
bw config stable [address]                 # Get/set primary stablecoin
bw plan create <name> <price>              # Create subscription plan
bw set encrypt <nft_id> <data>             # Update NFT encrypted data
bw --debug --cleanup <address>             # Sweep all testnet BTC to address
```

- **Token shortcuts**: `btc` (native), `stable` (contract's payment token), or `0x` address
- **Roles**: `admin`, `server`, `hot`, `dev`, `broker` (resolved from addressbook.json)
- **Signing**: Only roles with `keyfile` in addressbook can be used as `<from>`/`<wallet>`

The fund-manager imports `executeSend()`, `executeWithdraw()`, and `executeSwap()` from bw directly — all wallet operations flow through the same code paths.

## ab (addressbook)

Manages wallet entries in `/etc/blockhost/addressbook.json`. No RPC or contract config required.

```bash
ab add <name> <0xaddress>    # Add new entry
ab del <name>                # Delete entry
ab up <name> <0xaddress>     # Update entry's address
ab new <name>                # Generate new wallet, save key, add to addressbook
ab list                      # Show all entries
ab --init <admin> <server> [dev] [broker] <keyfile>  # Bootstrap addressbook
```

- **Immutable roles**: `server`, `admin`, `hot`, `dev`, `broker` — cannot be added, deleted, updated, or generated via `ab`
- **`ab new`**: Generates a keypair, saves private key to `/etc/blockhost/<name>.key`
- **`ab --init`**: Bootstrap for fresh installs. Keyfile is always the last argument. Fails if addressbook already has entries.

## is (identity predicate)

Yes/no identity questions. Exit 0 = yes, 1 = no. Config from `web3-defaults.yaml`.

```bash
is <wallet> <nft_id>         # Does wallet own NFT token?
is contract <address>        # Does a contract exist at address?
```

Arguments are order-independent, disambiguated by type (address = `0x` + 64 hex, NFT ID = integer, `contract` = keyword).
