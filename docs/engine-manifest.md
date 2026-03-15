# Engine Manifest

`engine.json` declares engine identity, wizard plugin module, finalization steps, and chain-specific `constraints` used by consumers (installer, admin panel) for input validation and UI rendering.

## Schema

```json
{
  "name": "opnet",
  "version": "0.1.0",
  "display_name": "OPNet (Bitcoin L1)",
  "accent_color": "#F97900",
  "setup": {
    "first_boot_hook": "/usr/share/blockhost/engine-hooks/first-boot.sh",
    "wizard_module": "blockhost.engine_opnet.wizard",
    "finalization_steps": ["wallet", "contracts", "chain_config"],
    "post_finalization_steps": ["mint_nft", "plan", "revenue_share"]
  },
  "config_keys": {
    "session_key": "blockchain"
  },
  "constraints": { ... }
}
```

## Constraints

| Field | Description | OPNet value |
|-------|-------------|-------------|
| `address_pattern` | Regex for valid addresses | `^(0x[0-9a-fA-F]{64}\|(bc\|tb\|bcrt\|op\|opt\|opr)1[a-z0-9]{8,87})$` |
| `native_token` | Native currency keyword for CLIs | `btc` |
| `native_token_label` | Display label for native currency | `BTC` |
| `token_pattern` | Regex for valid token addresses | `^0x[0-9a-fA-F]{64}$` |
| `address_placeholder` | Placeholder for address inputs | `0x...` |

All patterns are anchored regexes. If `constraints` is absent, consumers skip format validation and let CLIs reject invalid input.

## Theming

The `accent_color` field provides the primary brand color used by the signup page generator and signing page template (as `--primary` CSS variable).
