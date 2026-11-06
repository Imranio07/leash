use anchor_lang::prelude::*;

/// Seed prefix for the Vault PDA: ["vault", owner, agent].
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

/// Max number of allowlisted recipient wallets. Must match the array size in `Vault`.
pub const MAX_ALLOWLIST: usize = 8;

/// Length of one spending window. Days are UTC because unix time is UTC.
pub const SECONDS_PER_DAY: i64 = 86_400;
