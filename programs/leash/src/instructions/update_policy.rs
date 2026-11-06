use anchor_lang::prelude::*;

use crate::{constants::VAULT_SEED, error::LeashError, state::Vault};

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

/// Replaces the policy. Does not touch `revoked` or today's spending.
pub fn handle_update_policy(
    ctx: Context<UpdatePolicy>,
    per_tx_max: u64,
    daily_cap: u64,
    allowlist: Vec<Pubkey>,
    expires_at: i64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.set_allowlist(&allowlist)?;
    vault.per_tx_max = per_tx_max;
    vault.daily_cap = daily_cap;
    vault.expires_at = expires_at;
    Ok(())
}
