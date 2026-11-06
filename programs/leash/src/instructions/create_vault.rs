use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::{SECONDS_PER_DAY, VAULT_SEED},
    state::Vault,
};

#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: only the address is stored; this key becomes the vault's agent.
    pub agent: UncheckedAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = owner,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, owner.key().as_ref(), agent.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_vault(
    ctx: Context<CreateVault>,
    per_tx_max: u64,
    daily_cap: u64,
    allowlist: Vec<Pubkey>,
    expires_at: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault = &mut ctx.accounts.vault;

    vault.set_allowlist(&allowlist)?;
    vault.owner = ctx.accounts.owner.key();
    vault.agent = ctx.accounts.agent.key();
    vault.mint = ctx.accounts.mint.key();
    vault.per_tx_max = per_tx_max;
    vault.daily_cap = daily_cap;
    vault.expires_at = expires_at;
    vault.spent_today = 0;
    vault.day_index = now / SECONDS_PER_DAY;
    vault.revoked = false;
    vault.bump = ctx.bumps.vault;
    Ok(())
}
