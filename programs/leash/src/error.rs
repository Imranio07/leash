use anchor_lang::prelude::*;

// Codes start at 6000 in this order. Do not reorder: clients and the README map codes to names.
#[error_code]
pub enum LeashError {
    #[msg("Vault is revoked by the owner")]
    VaultRevoked,
    #[msg("Vault policy has expired")]
    PolicyExpired,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Amount exceeds the per-payment limit")]
    ExceedsPerTxLimit,
    #[msg("Payment would exceed the daily cap")]
    ExceedsDailyCap,
    #[msg("Recipient is not on the vault allowlist")]
    RecipientNotAllowed,
    #[msg("Token account mint does not match the vault mint")]
    WrongMint,
    #[msg("Allowlist can hold at most 8 recipients")]
    AllowlistTooLong,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Signer is not allowed to do this on this vault")]
    Unauthorized,
}
