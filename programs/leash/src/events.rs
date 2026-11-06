use anchor_lang::prelude::*;

#[event]
pub struct PaymentEvent {
    pub vault: Pubkey,
    pub agent: Pubkey,
    /// Recipient wallet (owner of the recipient token account), the same key checked against the allowlist.
    pub recipient: Pubkey,
    pub amount: u64,
    /// sha256 of the user's task text.
    pub intent_hash: [u8; 32],
    /// Total spent in the current UTC day, including this payment.
    pub spent_today: u64,
    pub timestamp: i64,
}
