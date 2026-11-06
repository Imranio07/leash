use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{constants::VAULT_SEED, error::LeashError, state::Vault};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        address = vault.mint @ LeashError::WrongMint,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = vault_token_account.mint == vault.mint @ LeashError::WrongMint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    /// Funds can only go back to the owner.
    #[account(
        mut,
        constraint = owner_token_account.mint == vault.mint @ LeashError::WrongMint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Works even when the vault is revoked or expired.
pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, LeashError::InvalidAmount);

    let vault = &ctx.accounts.vault;
    let bump = [vault.bump];
    let seeds: &[&[u8]] = &[
        VAULT_SEED,
        vault.owner.as_ref(),
        vault.agent.as_ref(),
        &bump,
    ];
    let signer_seeds = &[seeds];

    let accounts = TransferChecked {
        from: ctx.accounts.vault_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.owner_token_account.to_account_info(),
        authority: vault.to_account_info(),
    };
    transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), accounts, signer_seeds),
        amount,
        ctx.accounts.mint.decimals,
    )
}
