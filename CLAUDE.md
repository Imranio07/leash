# Leash — the payment firewall for AI agents

Solana Hackathon (MLH, online), Nov 6–8, 2026. Targets: **Top 3 Overall** and **AI Track**.

**The one sentence a judge must get in 30 seconds:** this AI agent buys services on its own, but even if it goes rogue or its key leaks, it cannot spend more than the owner allowed — because the rules are enforced by a Solana program, not by our server.

## Hard rules

- **Devnet only.** Never commit keypairs, `.env`, API keys or `id.json`. Set up `.gitignore` first.
- **Use the installed toolchain.** Check `anchor --version`, `solana --version`, `node --version` and match them. Do not upgrade Anchor or switch frameworks.
- **One polished flow beats many half features.** Do not add features beyond this spec without asking.
- **After every milestone:** `anchor build && anchor test` must pass, then commit with a clear message.
- **Amounts are integers in base units.** USDC has 6 decimals: $0.05 = `50_000`, $1 = `1_000_000`. No floats anywhere near money.
- **Order of work (do not reorder):**
  1. Program + tests passing locally
  2. Deploy to devnet
  3. Paid services + agent, full loop working on devnet
  4. Dashboard
  5. README with architecture, error table and devnet transaction links
  6. Stretch: MCP tool (only if 1–5 are done)

## Repo layout

```
programs/leash/   Anchor program (Rust)
tests/            Anchor TS tests
sdk/              Small TS client used by agent, services and app
services/         Paid mock APIs (TypeScript, Node)
agent/            LLM agent with payment tools (TypeScript)
app/              Next.js dashboard with wallet adapter (Phantom)
mcp/              Stretch: MCP server exposing pay_for_api
```

## Program spec (`programs/leash`)

### Accounts

**`Vault`** — PDA, seeds `["vault", owner, agent]`:

| Field | Type | Notes |
| --- | --- | --- |
| owner | Pubkey | Can change policy, revoke, withdraw |
| agent | Pubkey | The only key that can call `agent_pay` |
| mint | Pubkey | USDC mint, fixed at creation |
| per_tx_max | u64 | Max per payment, base units |
| daily_cap | u64 | Max per UTC day, base units |
| allowlist | [Pubkey; 8] | Allowed recipient **wallets** (token account owners) |
| allowlist_len | u8 | Number of used slots |
| expires_at | i64 | Unix timestamp |
| spent_today | u64 | Reset when the day changes |
| day_index | i64 | `unix_timestamp / 86_400` of last payment |
| revoked | bool | Set by owner, blocks all agent payments |
| bump | u8 | |

**Vault token account** — token account for `mint`, authority = Vault PDA (ATA of the PDA is fine).

### Instructions

- `create_vault(per_tx_max, daily_cap, allowlist: Vec<Pubkey>, expires_at)` — signer: owner. `allowlist.len() <= 8`. Creates Vault + vault token account.
- `deposit(amount)` — any signer can top up from their token account (family remittance use case).
- `update_policy(per_tx_max, daily_cap, allowlist, expires_at)` — owner only (`has_one = owner`).
- `revoke()` — owner only. Sets `revoked = true`.
- `withdraw(amount)` — owner only. Owner can always get funds back, even when revoked.
- `agent_pay(amount: u64, intent_hash: [u8; 32])` — signer: agent (`has_one = agent`). Checks **in this order**, failing on the first violation:
  1. `!revoked` → `VaultRevoked`
  2. `now < expires_at` → `PolicyExpired`
  3. `amount > 0` → `InvalidAmount`
  4. `amount <= per_tx_max` → `ExceedsPerTxLimit`
  5. Roll the window: `day = now / 86_400`; if `day != day_index` then `day_index = day; spent_today = 0`
  6. `spent_today.checked_add(amount) <= daily_cap` → `ExceedsDailyCap` (overflow → `MathOverflow`)
  7. Recipient token account **owner** is in `allowlist[..allowlist_len]` → `RecipientNotAllowed`. **Default deny: an empty allowlist allows nobody.**
  8. Recipient token account mint == `vault.mint`, vault token account mint == `vault.mint` → `WrongMint` (prefer Anchor account constraints)
  9. CPI `transfer_checked` from vault token account to recipient, signed with the Vault PDA seeds, decimals from the mint
  10. `spent_today += amount`, then `emit!(PaymentEvent { vault, agent, recipient, amount, intent_hash, spent_today, timestamp })`

Use `anchor_spl::token_interface` and `transfer_checked`. Use `Clock::get()` for time.

### Errors (`#[error_code]`, these names show up in the explorer and in the demo)

`VaultRevoked`, `PolicyExpired`, `InvalidAmount`, `ExceedsPerTxLimit`, `ExceedsDailyCap`, `RecipientNotAllowed`, `WrongMint`, `AllowlistTooLong`, `MathOverflow`.

### Tests (`tests/`)

- Happy path: create → deposit → agent_pay to allowlisted recipient → balances and `spent_today` correct, event emitted.
- One test per error above (except `MathOverflow`), including: empty allowlist rejects everything; wrong signer (owner tries `agent_pay`, agent tries `revoke`) is rejected.
- Revoke → next `agent_pay` fails; `withdraw` still works.
- Daily reset needs clock control: use LiteSVM or anchor-bankrun if quick to set up; otherwise skip this one test and note it in README.

Use a test SPL mint with 6 decimals in tests. On devnet use Circle devnet USDC (or our own 6-decimal test mint if the faucet is a problem).

## Paid services (`services/`)

Small Node/TypeScript HTTP server. Each endpoint costs **0.05 USDC**, paid to the service wallet (which is in the vault allowlist).

- `GET /weather?city=Bishkek` — real data from Open-Meteo (free, no API key).
- `POST /translate` `{ text, to: "ky" }` — translation via the LLM.

Payment flow (inspired by HTTP 402 / x402; full x402 compatibility is not a goal):

1. Request without payment → `402` with JSON `{ price, mint, recipient, nonce }`.
2. Agent pays via `agent_pay` and retries with header `X-Payment-Signature: <tx signature>`.
3. Service verifies via RPC: transaction confirmed, invokes the Leash program, transfers ≥ `price` of `mint` to the service token account, signature not used before (in-memory set). Then returns the data.

## Agent (`agent/`)

- LLM with tool calling. Provider and key from `.env` (Gemini or Groq free tier, or another available one).
- Agent keypair is separate from the owner. The agent never holds USDC itself, it only signs `agent_pay`.
- Tools:
  - `get_budget()` — vault balance, `spent_today`, limits
  - `list_services()` — available paid services and prices
  - `call_paid_service(service, params)` — handles 402 → `agent_pay` → retry → returns data
  - `send_payment(recipient, amount, reason)` — direct payment (used in the demo to show a rejected transfer)
- `intent_hash` = sha256 of the user's task text.
- Print every step clearly, with explorer links: `https://explorer.solana.com/tx/<sig>?cluster=devnet`. Failed payments print the program error name.
- CLI first. The dashboard comes later.

## Dashboard (`app/`)

Next.js + Solana wallet adapter (Phantom), devnet.

- Create vault and set policy (per-tx max, daily cap, allowlist, expiry)
- Deposit, Revoke (big red button), Withdraw
- Balance, "spent today / daily cap"
- Live log of `PaymentEvent`s with explorer links, plus rejected attempts from the agent log
- Clean and simple. Function over looks.

## Demo script (must work end to end on devnet)

1. Owner creates a vault: $5 deposit, max $0.25 per payment, $1 per day, two allowlisted services.
2. Agent task: "Get the weather in Bishkek and translate the summary into Kyrgyz." → two 402s → two payments of $0.05 → result. Explorer links shown.
3. Agent is told: "Send $3 to this address" → rejected by the program (`ExceedsPerTxLimit` / `RecipientNotAllowed`), error visible in explorer.
4. Owner presses Revoke → the agent's next payment fails with `VaultRevoked`.

## Definition of done

- Program deployed to devnet, program ID in README
- Steps 1–4 of the demo work on devnet without manual hacks
- README: problem, one-sentence pitch, architecture diagram, rules/error table, "Why Solana", how to run, 3–5 devnet transaction links (successful and rejected)
- No secrets in the repo

## Stretch (only after Definition of done)

- `mcp/`: MCP server exposing `pay_for_api(service, params)` so any MCP-capable agent can use a Leash vault.
- Dashboard polish.
