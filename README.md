# Leash: the payment firewall for AI agents

This AI agent buys services on its own. Even if it goes rogue or its key leaks, it cannot spend more than the owner allowed, because a Solana program enforces the rules, not our server.

> Work in progress for the Solana Hackathon (MLH, Nov 6–8, 2026).

## Devnet deployment

| | |
| --- | --- |
| Program ID | `3Szo7yDv7saKcXDuYA3BCgRV8YrajNFNCxU3c1WRAHu6` |
| Explorer | [explorer.solana.com/address/3Szo7y…HAu6?cluster=devnet](https://explorer.solana.com/address/3Szo7yDv7saKcXDuYA3BCgRV8YrajNFNCxU3c1WRAHu6?cluster=devnet) |
| IDL | Stored on-chain via Program Metadata (account `8gGSoCCgzciHKAK9nLiW59E1fxnGwSGdt5GXDY2GyFam`). Fetch with `anchor idl fetch --provider.cluster devnet 3Szo7yDv7saKcXDuYA3BCgRV8YrajNFNCxU3c1WRAHu6` |

## What the program enforces

The owner funds a vault and sets a policy. The agent key can only call `agent_pay`, and every payment must pass these checks, in this order:

| # | Rule | Error (code) |
| --- | --- | --- |
| 1 | Vault is not revoked | `VaultRevoked` (6000) |
| 2 | Policy has not expired | `PolicyExpired` (6001) |
| 3 | Amount > 0 | `InvalidAmount` (6002) |
| 4 | Amount ≤ per-payment max | `ExceedsPerTxLimit` (6003) |
| 5–6 | Spent today + amount ≤ daily cap (UTC day) | `ExceedsDailyCap` (6004) |
| 7 | Recipient wallet is on the allowlist (empty allowlist allows nobody) | `RecipientNotAllowed` (6005) |
| 8 | Token accounts use the vault's mint | `WrongMint` (6006) |

Other errors: `AllowlistTooLong` (6007, max 8 recipients), `MathOverflow` (6008), `Unauthorized` (6009, wrong signer: only the agent can pay, only the owner can update, revoke or withdraw).

## Build and test

Requires Anchor CLI 1.1.2, Solana CLI 3.1 and Rust 1.89 (pinned in `rust-toolchain.toml`).

```sh
anchor build
anchor test   # Rust tests on LiteSVM, no local validator needed
```
