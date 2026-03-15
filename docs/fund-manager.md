# Fund Manager

Integrated into the monitor polling loop. Automates fund withdrawal from the contract, revenue sharing, and gas management.

## Fund Cycle (every 24h, configurable)

1. **Withdraw** — If payment token balance > min threshold, call `withdrawFunds()` to move tokens from contract to hot wallet
2. **Hot wallet gas** — Server sends BTC to hot wallet if below threshold (default 100,000 sats)
3. **Server stablecoin buffer** — Hot wallet sends stablecoin to server if below threshold
4. **Revenue shares** — If enabled in `revenue-share.json`, distribute configured % to dev/broker
5. **Remainder to admin** — Send all remaining hot wallet token balances to admin

## Gas Check (every 30min, configurable)

- Top up hot wallet BTC from server if below threshold
- Check server wallet BTC balance; warn if below `gas_low_threshold_sats`

## Hot Wallet

Auto-generated on first fund cycle if not in addressbook. Private key saved to `/etc/blockhost/hot.key` (chmod 600). Acts as an intermediary for distribution — contract funds flow through it before going to recipients.

## Configuration

In `/etc/blockhost/blockhost.yaml` under the `fund_manager:` key:

| Setting | Default | Description |
|---|---|---|
| `fund_cycle_interval_hours` | 24 | Hours between fund cycles |
| `gas_check_interval_minutes` | 30 | Minutes between gas checks |
| `min_withdrawal_sats` | 50,000 | Minimum token amount (base units) to trigger withdrawal |
| `gas_low_threshold_sats` | 10,000 | Server BTC balance (sats) that triggers a warning |
| `gas_swap_amount_sats` | 50,000 | Amount (sats) for NativeSwap gas top-up |
| `server_stablecoin_buffer_sats` | 5,000,000 | Target stablecoin balance (base units) for server wallet |
| `hot_wallet_gas_sats` | 100,000 | Target BTC balance (sats) for hot wallet |
