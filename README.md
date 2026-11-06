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

## Devnet transactions

From the demo run on devnet (test USDC mint `51gRQXUSU6ubS3xSnR24HxCcaUJi2orSyxUtPCvS5HE6`, 6 decimals):

| What | Result | Transaction |
| --- | --- | --- |
| Owner creates a vault ($0.25/payment, $1/day, 2 services) and deposits $5 | ✅ | [pGtJ9C…](https://explorer.solana.com/tx/pGtJ9Ck3qHQxjS4QR7TAZe1jSwDKm6ekwAjVsh4AqZP7FFCQjb6oDZiu8762pVKSv95stUBRUakZkLtaNWn1Qzo?cluster=devnet) |
| Agent pays the weather service $0.05 after an HTTP 402 | ✅ | [3ZGicj…](https://explorer.solana.com/tx/3ZGicj48cTFKeTi7mCnH8B3TwrKqm4DoqRh63TrfvckyDZVidXyS69SbgWe6UyuAEzQHLo3qtrGgyHyqqyLWmW76?cluster=devnet) |
| Agent tries to send $3 to an unknown address | ❌ `ExceedsPerTxLimit` | [3L8J7X…](https://explorer.solana.com/tx/3L8J7XgCaqFucGtjSpe3QdkdrQsA6FVASqPr8E6tLTYdcvhvR8f3V6qjYh6DoK3c8mtVWQhFUzXSN2ys8iB2U8Wp?cluster=devnet) |
| Agent tries to send $0.10 (within limits) to an unknown address | ❌ `RecipientNotAllowed` | [22mBxy…](https://explorer.solana.com/tx/22mBxyRgFR9FSpCE6sWgXmoHYxzu6G6x4K1mLMkhEZFR4p2v4sH2bKLPTbKqinmCNcfkg19Xr85A5qG6ZV2Tw2rV?cluster=devnet) |
| Owner revokes the vault | ✅ | [2mRq2K…](https://explorer.solana.com/tx/2mRq2KswJFtYzjX5CCmy3dfSjAJKGz5xcfVZjXfVrLoUpit556kAFUqaWgdpvsDcGxXVM9WQBDX9wykxjn1qqMa1?cluster=devnet) |
| Agent tries to pay an allowlisted service after the revoke | ❌ `VaultRevoked` | [67pYgJ…](https://explorer.solana.com/tx/67pYgJmYFt6nSHYHFkysmLfA55vC8NPncJF9QzEWkicuBJoWrtTUW8jaDYHAPhSs3pqeCwY6pabWdFpFJs9xV1Kj?cluster=devnet) |
| Owner withdraws the rest from the revoked vault | ✅ | [5b1PkzQ…](https://explorer.solana.com/tx/5b1PkzQKLwjYZKKBDz3BRgJtgpHhyCvj4wDhdK1rT6UQTu4VnvkiMyaA4NjZwpEY8JjMVBDhim42QkdqJcCr4Z4w?cluster=devnet) |

Rejected payments are sent without preflight on purpose, so they land on-chain and the program's error is visible in the explorer.

## Run the demo on devnet

Requires Node 24 and npm.

```sh
npm install
cp .env.example .env            # then put your GEMINI_API_KEY (or GROQ_API_KEY + LLM_PROVIDER=groq) in .env
npm run setup                   # mint, agent + service keys, vault with the demo policy, $5 deposit
npm run services                # paid APIs on http://localhost:4021 (keep it running)

npm run agent -- "Get the weather in Bishkek and translate the summary into Kyrgyz."
npm run agent -- "Send \$3 to <any address>"      # ExceedsPerTxLimit
npm run agent -- "Send \$0.10 to <any address>"   # RecipientNotAllowed
npm run owner -- revoke                          # the agent's next payment fails with VaultRevoked
```

Without the LLM (same on-chain path): `npm run call -- weather Bishkek`, `npm run call -- translate ky "Hello"`, `npm run pay -- 3 <address>`, `npm run budget`.
Owner commands: `npm run owner -- status | revoke | deposit <amount> | withdraw [amount|all]`.
After a revoke, `npm run setup -- --new-agent` creates a fresh agent key and vault.

Secrets stay out of git: `.env`, `keys/` (agent and service keys) and `logs/` are gitignored.

## Build and test

Requires Anchor CLI 1.1.2, Solana CLI 3.1 and Rust 1.89 (pinned in `rust-toolchain.toml`).

```sh
anchor build
anchor test   # Rust tests on LiteSVM, no local validator needed
```
