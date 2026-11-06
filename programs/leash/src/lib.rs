pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("3Szo7yDv7saKcXDuYA3BCgRV8YrajNFNCxU3c1WRAHu6");

/// Leash: an on-chain spending policy for AI agents.
/// The owner funds a vault and sets limits; the agent key can only pay within them.
#[program]
pub mod leash {
    use super::*;

    pub fn create_vault(
        ctx: Context<CreateVault>,
        per_tx_max: u64,
        daily_cap: u64,
        allowlist: Vec<Pubkey>,
        expires_at: i64,
    ) -> Result<()> {
        instructions::create_vault::handle_create_vault(
            ctx, per_tx_max, daily_cap, allowlist, expires_at,
        )
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        per_tx_max: u64,
        daily_cap: u64,
        allowlist: Vec<Pubkey>,
        expires_at: i64,
    ) -> Result<()> {
        instructions::update_policy::handle_update_policy(
            ctx, per_tx_max, daily_cap, allowlist, expires_at,
        )
    }

    pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
        instructions::revoke::handle_revoke(ctx)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, amount)
    }

    pub fn agent_pay(ctx: Context<AgentPay>, amount: u64, intent_hash: [u8; 32]) -> Result<()> {
        instructions::agent_pay::handle_agent_pay(ctx, amount, intent_hash)
    }
}
