use anchor_lang::prelude::*;

use crate::{constants::VAULT_SEED, error::LeashError, state::Vault};

#[derive(Accounts)]
pub struct Revoke<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

/// One-way kill switch: the agent can never pay from this vault again.
/// The owner can still withdraw.
pub fn handle_revoke(ctx: Context<Revoke>) -> Result<()> {
    ctx.accounts.vault.revoked = true;
    Ok(())
}
