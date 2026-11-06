use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    constants::{SECONDS_PER_DAY, VAULT_SEED},
    error::LeashError,
    events::PaymentEvent,
    state::Vault,
};

#[derive(Accounts)]
pub struct AgentPay<'info> {
    pub agent: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        has_one = agent @ LeashError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
    // Rule 8 (mints) is enforced here, so it fails before the handler runs.
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
    #[account(
        mut,
        constraint = recipient_token_account.mint == vault.mint @ LeashError::WrongMint,
        token::token_program = token_program,
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_agent_pay(ctx: Context<AgentPay>, amount: u64, intent_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let recipient = ctx.accounts.recipient_token_account.owner;

    // Rules 1-7, in order, failing on the first violation.
    let new_spent = {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.revoked, LeashError::VaultRevoked);
        require!(now < vault.expires_at, LeashError::PolicyExpired);
        require!(amount > 0, LeashError::InvalidAmount);
        require!(amount <= vault.per_tx_max, LeashError::ExceedsPerTxLimit);

        let day = now / SECONDS_PER_DAY;
        if day != vault.day_index {
            vault.day_index = day;
            vault.spent_today = 0;
        }

        let new_spent = vault
            .spent_today
            .checked_add(amount)
            .ok_or(LeashError::MathOverflow)?;
        require!(new_spent <= vault.daily_cap, LeashError::ExceedsDailyCap);
        require!(
            vault.is_allowed(&recipient),
            LeashError::RecipientNotAllowed
        );
        new_spent
    };

    // Rule 9: move the tokens, signed by the vault PDA.
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
        to: ctx.accounts.recipient_token_account.to_account_info(),
        authority: vault.to_account_info(),
    };
    transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), accounts, signer_seeds),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    // Rule 10: record the spend and emit the event.
    let vault = &mut ctx.accounts.vault;
    vault.spent_today = new_spent;
    emit!(PaymentEvent {
        vault: vault.key(),
        agent: vault.agent,
        recipient,
        amount,
        intent_hash,
        spent_today: new_spent,
        timestamp: now,
    });
    Ok(())
}
