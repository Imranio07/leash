use anchor_lang::prelude::*;

use crate::{constants::MAX_ALLOWLIST, error::LeashError};

/// Spending policy and counters for one (owner, agent) pair.
/// Funds live in the vault's token account, whose authority is this PDA.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Can change policy, revoke and withdraw.
    pub owner: Pubkey,
    /// The only key that can call `agent_pay`.
    pub agent: Pubkey,
    /// Token mint (USDC), fixed at creation.
    pub mint: Pubkey,
    /// Max amount per payment, base units.
    pub per_tx_max: u64,
    /// Max total per UTC day, base units.
    pub daily_cap: u64,
    /// Allowed recipient wallets (token account owners). Only the first `allowlist_len` are used.
    pub allowlist: [Pubkey; 8],
    pub allowlist_len: u8,
    /// Unix timestamp after which the agent can no longer pay.
    pub expires_at: i64,
    /// Amount spent in the day `day_index`.
    pub spent_today: u64,
    /// `unix_timestamp / 86_400` of the current spending window.
    pub day_index: i64,
    /// Set by the owner; blocks every agent payment.
    pub revoked: bool,
    pub bump: u8,
}

impl Vault {
    pub fn set_allowlist(&mut self, list: &[Pubkey]) -> Result<()> {
        require!(list.len() <= MAX_ALLOWLIST, LeashError::AllowlistTooLong);
        self.allowlist = [Pubkey::default(); MAX_ALLOWLIST];
        self.allowlist[..list.len()].copy_from_slice(list);
        self.allowlist_len = list.len() as u8;
        Ok(())
    }

    /// Default deny: an empty allowlist allows nobody.
    pub fn is_allowed(&self, wallet: &Pubkey) -> bool {
        self.allowlist[..self.allowlist_len as usize].contains(wallet)
    }
}
