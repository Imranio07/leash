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

From the LLM agent demo run on devnet (Gemini, test USDC mint `51gRQXUSU6ubS3xSnR24HxCcaUJi2orSyxUtPCvS5HE6`, 6 decimals):

| Step | What | Result | Transaction |
| --- | --- | --- | --- |
| 1 | Owner creates a vault ($0.25/payment, $1/day, 2 services) and deposits $5 | ✅ | [4GtWGn…](https://explorer.solana.com/tx/4GtWGniWMbA1YftgKeWADiashhJa69ZW1aKDuQsgKcAimoRe2KQ3idEUZAZQs4zh3LDUKrTFyk8KpXESp5p7jDoV?cluster=devnet) |
| 2 | "Get the weather in Bishkek and translate the summary into Kyrgyz.": 402, agent pays the weather service $0.05 | ✅ | [eXwaGu…](https://explorer.solana.com/tx/eXwaGuYEZXuhdgVUD2giMHZ7XqS5k39eBSVW1UYGgmFaytsT6Rk4f2utRUz14jnuF3t8pmgNFdUFPsXsRFiAUiw?cluster=devnet) |
| 2 | 402, agent pays the translate service $0.05 | ✅ | [3txNGW…](https://explorer.solana.com/tx/3txNGWRqhbEGh3j4BxrrSFByeXgFiTLpeGsh7PAJnpDmiCcjzEZ7ASwLKTscQnxnqVv4jGaZvSEbQQbq5jMKCoSE?cluster=devnet) |
| 3 | "Send $3 to 3nfy…EiLC" | ❌ `ExceedsPerTxLimit` | [4GcZJs…](https://explorer.solana.com/tx/4GcZJsZwaahUMuCnjYdmZKhWa9MTyAraViWchYwU7NXxAHykoifGB9pckCJy12XACKSC1vNPcseqt9rVQuJ2jBSv?cluster=devnet) |
| 3b | "Send $0.10 to 3nfy…EiLC": within limits, but not on the allowlist | ❌ `RecipientNotAllowed` | [5K3Nf7…](https://explorer.solana.com/tx/5K3Nf7CVyLgwhwqZvc8SVZggVHnQiWjwHP54waCJSZizGhHrzco35ekine5DLXbswPyYmj3PDZTpyznanNSacTBx?cluster=devnet) |
| 4 | Owner revokes the vault | ✅ | [4PMCN2…](https://explorer.solana.com/tx/4PMCN2duzsCKQSxiVb5L8Ke2d8neABYkAaZiHZfHBpRwobgvo69UoAhfsrGKtHzkTn3WXnbfrCfkYwRbVEK1UwMx?cluster=devnet) |
| 4 | "Get the weather in Bishkek.": the agent's next payment | ❌ `VaultRevoked` | [2jzsaJ…](https://explorer.solana.com/tx/2jzsaJZ2oHqR3mtLqZ7kDJTK9HWpM3ZBPdgKidxjKkJyG8b4J6VgcUmX1numMuieqKxqx6Dbg31H1admSkMTtQwr?cluster=devnet) |
| | Owner withdraws the rest from the revoked vault | ✅ | [2DXdwV…](https://explorer.solana.com/tx/2DXdwVcAdZmehXCH1UVXGovA2xBvZVr9jM1h7zwcT1av8MqzAkJMzhASGp9SFhv3kx68yUb1ToGs8GDw7wvSPYcW?cluster=devnet) |

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

The Gemini free tier allows about 20 requests per day per model. The agent starts with `gemini-3.8-flash` and moves to `gemini-3.5-flash`, then `gemini-3.5-flash-lite`, when a model is out of quota, overloaded or not answering (`LLM_MODEL`, `LLM_FALLBACK_MODELS` in `.env`).

Secrets stay out of git: `.env`, `keys/` (agent and service keys) and `logs/` are gitignored.

## Build and test

Requires Anchor CLI 1.1.2, Solana CLI 3.1 and Rust 1.89 (pinned in `rust-toolchain.toml`).

```sh
anchor build
anchor test   # Rust tests on LiteSVM, no local validator needed
```
