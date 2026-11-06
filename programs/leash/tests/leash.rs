//! Leash program tests (LiteSVM). Run with `anchor test` (builds the .so first).

mod common;

use {
    anchor_lang::prelude::Pubkey, common::*, leash::error::LeashError, litesvm_token::CreateMint,
    solana_keypair::Keypair, solana_signer::Signer,
};

// ---------- happy path ----------

#[test]
fn happy_path_agent_pays_allowlisted_service() {
    let mut env = Env::demo();
    assert_eq!(env.balance(&env.vault_ata), 5 * USDC);
    assert_eq!(env.balance(&env.owner_ata), 95 * USDC);

    let v = env.vault_state();
    assert_eq!(v.owner, env.owner.pubkey());
    assert_eq!(v.agent, env.agent.pubkey());
    assert_eq!(v.mint, env.mint);
    assert_eq!(v.per_tx_max, 25 * CENT);
    assert_eq!(v.daily_cap, USDC);
    assert_eq!(v.allowlist_len, 2);
    assert_eq!(
        v.allowlist[..2],
        [env.weather.pubkey(), env.translate.pubkey()]
    );
    assert_eq!(v.expires_at, START_TS + 30 * DAY);
    assert_eq!(v.spent_today, 0);
    assert_eq!(v.day_index, START_TS / DAY);
    assert!(!v.revoked);

    let task = intent_hash("Get the weather in Bishkek and translate the summary into Kyrgyz.");
    let agent = env.agent.insecure_clone();
    let meta = env
        .pay_with(&agent, 5 * CENT, env.weather_ata, env.mint, task)
        .unwrap();

    assert_eq!(env.balance(&env.vault_ata), 5 * USDC - 5 * CENT);
    assert_eq!(env.balance(&env.weather_ata), 5 * CENT);
    assert_eq!(env.vault_state().spent_today, 5 * CENT);

    let events = payment_events(&meta);
    assert_eq!(events.len(), 1);
    let e = &events[0];
    assert_eq!(e.vault, env.vault);
    assert_eq!(e.agent, env.agent.pubkey());
    assert_eq!(e.recipient, env.weather.pubkey());
    assert_eq!(e.amount, 5 * CENT);
    assert_eq!(e.intent_hash, task);
    assert_eq!(e.spent_today, 5 * CENT);
    assert_eq!(e.timestamp, START_TS);

    // A second payment, to the other service, adds up.
    let meta = env.pay(5 * CENT, env.translate_ata).unwrap();
    assert_eq!(env.balance(&env.translate_ata), 5 * CENT);
    assert_eq!(env.vault_state().spent_today, 10 * CENT);
    assert_eq!(payment_events(&meta)[0].spent_today, 10 * CENT);
}

#[test]
fn anyone_can_deposit() {
    let mut env = Env::demo();
    let relative = env.new_wallet();
    let relative_ata = env.ata(&relative.pubkey());
    env.mint_to(&relative_ata, 2 * USDC);

    env.deposit_from(&relative, relative_ata, 2 * USDC).unwrap();

    assert_eq!(env.balance(&env.vault_ata), 7 * USDC);
    assert_eq!(env.balance(&relative_ata), 0);
    assert_leash_err(env.deposit(0), LeashError::InvalidAmount);
}

/// The four steps of the demo script, end to end.
#[test]
fn demo_script() {
    // 1. Owner creates a vault: $5, max $0.25 per payment, $1 per day, two services.
    let mut env = Env::demo();
    let owner = env.owner.insecure_clone();

    // 2. Agent pays both services $0.05.
    env.pay(5 * CENT, env.weather_ata).unwrap();
    env.pay(5 * CENT, env.translate_ata).unwrap();

    // 3. "Send $3 to this address" is rejected by the program.
    let stranger = Keypair::new();
    let stranger_ata = env.ata(&stranger.pubkey());
    assert_leash_err(
        env.pay(3 * USDC, stranger_ata),
        LeashError::ExceedsPerTxLimit,
    );
    assert_leash_err(
        env.pay(5 * CENT, stranger_ata),
        LeashError::RecipientNotAllowed,
    );
    assert_eq!(env.balance(&stranger_ata), 0);

    // 4. Owner revokes; the next payment fails.
    env.revoke(&owner).unwrap();
    assert_leash_err(env.pay(5 * CENT, env.weather_ata), LeashError::VaultRevoked);
    assert_eq!(env.balance(&env.vault_ata), 5 * USDC - 10 * CENT);
}

// ---------- rule 1: revoke ----------

#[test]
fn revoked_vault_blocks_agent_but_owner_can_withdraw() {
    let mut env = Env::demo();
    let owner = env.owner.insecure_clone();
    env.pay(5 * CENT, env.weather_ata).unwrap();

    env.revoke(&owner).unwrap();
    assert!(env.vault_state().revoked);
    assert_leash_err(env.pay(5 * CENT, env.weather_ata), LeashError::VaultRevoked);

    let rest = env.balance(&env.vault_ata);
    assert_eq!(rest, 5 * USDC - 5 * CENT);
    env.withdraw(&owner, env.owner_ata, rest).unwrap();
    assert_eq!(env.balance(&env.vault_ata), 0);
    assert_eq!(env.balance(&env.owner_ata), 95 * USDC + rest);
}

// ---------- rule 2: expiry ----------

#[test]
fn expired_policy_blocks_payments() {
    let mut env = Env::demo();
    let expires_at = env.vault_state().expires_at;

    env.set_time(expires_at - 1);
    env.pay(5 * CENT, env.weather_ata).unwrap();

    env.set_time(expires_at);
    assert_leash_err(
        env.pay(5 * CENT, env.weather_ata),
        LeashError::PolicyExpired,
    );
}

// ---------- rule 3: amount ----------

#[test]
fn zero_amount_is_rejected() {
    let mut env = Env::demo();
    assert_leash_err(env.pay(0, env.weather_ata), LeashError::InvalidAmount);
}

// ---------- rule 4: per-payment limit ----------

#[test]
fn per_payment_limit_boundary() {
    let mut env = Env::demo();

    env.pay(25 * CENT, env.weather_ata).unwrap();
    assert_leash_err(
        env.pay(25 * CENT + 1, env.weather_ata),
        LeashError::ExceedsPerTxLimit,
    );

    assert_eq!(env.balance(&env.weather_ata), 25 * CENT);
    assert_eq!(env.vault_state().spent_today, 25 * CENT);
}

// ---------- rules 5-6: daily cap ----------

#[test]
fn daily_cap_boundary_exact_cap_passes_one_unit_more_fails() {
    // per_tx_max = daily_cap so only the daily cap is in play.
    let mut env = Env::new();
    let policy = Policy {
        per_tx_max: USDC,
        daily_cap: USDC,
        ..env.demo_policy()
    };
    env.create_vault(&policy).unwrap();
    env.deposit(5 * USDC).unwrap();

    env.pay(60 * CENT, env.weather_ata).unwrap();

    // 0.60 + 0.40 + 1 unit = cap + 1: rejected, nothing moves.
    assert_leash_err(
        env.pay(40 * CENT + 1, env.weather_ata),
        LeashError::ExceedsDailyCap,
    );
    assert_eq!(env.vault_state().spent_today, 60 * CENT);

    // 0.60 + 0.40 = exactly the cap: passes.
    env.pay(40 * CENT, env.weather_ata).unwrap();
    assert_eq!(env.vault_state().spent_today, USDC);

    // Cap reached: even 1 base unit more is rejected.
    assert_leash_err(env.pay(1, env.weather_ata), LeashError::ExceedsDailyCap);

    assert_eq!(env.balance(&env.weather_ata), USDC);
    assert_eq!(env.balance(&env.vault_ata), 4 * USDC);
}

#[test]
fn daily_cap_resets_at_utc_midnight() {
    let mut env = Env::demo();
    for _ in 0..4 {
        env.pay(25 * CENT, env.weather_ata).unwrap();
    }
    assert_leash_err(env.pay(1, env.weather_ata), LeashError::ExceedsDailyCap);

    let today = START_TS / DAY;

    // Last second of the same UTC day: still capped.
    env.set_time((today + 1) * DAY - 1);
    assert_leash_err(env.pay(1, env.weather_ata), LeashError::ExceedsDailyCap);

    // 00:00:00 UTC next day: new window.
    env.set_time((today + 1) * DAY);
    env.pay(5 * CENT, env.weather_ata).unwrap();

    let v = env.vault_state();
    assert_eq!(v.day_index, today + 1);
    assert_eq!(v.spent_today, 5 * CENT);
    assert_eq!(env.balance(&env.weather_ata), USDC + 5 * CENT);
}

// ---------- rule 7: allowlist ----------

#[test]
fn recipient_not_on_allowlist_is_rejected() {
    let mut env = Env::demo();
    let stranger = Keypair::new();
    let stranger_ata = env.ata(&stranger.pubkey());

    assert_leash_err(
        env.pay(5 * CENT, stranger_ata),
        LeashError::RecipientNotAllowed,
    );

    assert_eq!(env.balance(&stranger_ata), 0);
    assert_eq!(env.balance(&env.vault_ata), 5 * USDC);
    assert_eq!(env.vault_state().spent_today, 0);
}

#[test]
fn empty_allowlist_allows_nobody() {
    let mut env = Env::new();
    let policy = Policy {
        allowlist: vec![],
        ..env.demo_policy()
    };
    env.create_vault(&policy).unwrap();
    env.deposit(5 * USDC).unwrap();
    assert_eq!(env.vault_state().allowlist_len, 0);

    assert_leash_err(
        env.pay(5 * CENT, env.weather_ata),
        LeashError::RecipientNotAllowed,
    );
    assert_leash_err(
        env.pay(5 * CENT, env.translate_ata),
        LeashError::RecipientNotAllowed,
    );

    // Unused slots hold the all-zero key; it must not count as allowed.
    let zero_ata = env.ata(&Pubkey::default());
    assert_leash_err(env.pay(5 * CENT, zero_ata), LeashError::RecipientNotAllowed);

    assert_eq!(env.balance(&env.vault_ata), 5 * USDC);
}

// ---------- rule 8: mint ----------

#[test]
fn wrong_mint_is_rejected() {
    let mut env = Env::demo();
    let owner = env.owner.insecure_clone();
    let other_mint = CreateMint::new(&mut env.svm, &owner)
        .decimals(DECIMALS)
        .send()
        .unwrap();
    let weather_other = create_ata(&mut env.svm, &owner, &env.weather.pubkey(), &other_mint);

    // Recipient token account of another mint.
    assert_leash_err(env.pay(5 * CENT, weather_other), LeashError::WrongMint);

    // Another mint passed as the mint account.
    let agent = env.agent.insecure_clone();
    let res = env.pay_with(
        &agent,
        5 * CENT,
        weather_other,
        other_mint,
        intent_hash("x"),
    );
    assert_leash_err(res, LeashError::WrongMint);

    assert_eq!(env.balance(&env.vault_ata), 5 * USDC);
}

// ---------- allowlist size ----------

#[test]
fn allowlist_longer_than_eight_is_rejected() {
    let mut env = Env::new();
    let owner = env.owner.insecure_clone();
    let nine: Vec<Pubkey> = (0..9).map(|_| Keypair::new().pubkey()).collect();

    let too_long = Policy {
        allowlist: nine.clone(),
        ..env.demo_policy()
    };
    assert_leash_err(env.create_vault(&too_long), LeashError::AllowlistTooLong);

    let eight = Policy {
        allowlist: nine[..8].to_vec(),
        ..env.demo_policy()
    };
    env.create_vault(&eight).unwrap();
    assert_eq!(env.vault_state().allowlist_len, 8);
    assert_eq!(env.vault_state().allowlist[..], nine[..8]);

    assert_leash_err(
        env.update_policy(&owner, &too_long),
        LeashError::AllowlistTooLong,
    );
    assert_eq!(env.vault_state().allowlist_len, 8);
}

// ---------- signers ----------

#[test]
fn only_the_agent_can_pay() {
    let mut env = Env::demo();
    let owner = env.owner.insecure_clone();
    let thief = env.new_wallet();

    assert_leash_err(
        env.pay_as(&owner, 5 * CENT, env.weather_ata),
        LeashError::Unauthorized,
    );
    assert_leash_err(
        env.pay_as(&thief, 5 * CENT, env.weather_ata),
        LeashError::Unauthorized,
    );

    assert_eq!(env.balance(&env.vault_ata), 5 * USDC);
}

#[test]
fn only_the_owner_can_manage_the_vault() {
    let mut env = Env::demo();
    let agent = env.agent.insecure_clone();
    let agent_ata = env.ata(&agent.pubkey());
    let looser = Policy {
        per_tx_max: 5 * USDC,
        daily_cap: 5 * USDC,
        ..env.demo_policy()
    };

    assert_leash_err(env.revoke(&agent), LeashError::Unauthorized);
    assert_leash_err(env.update_policy(&agent, &looser), LeashError::Unauthorized);
    assert_leash_err(
        env.withdraw(&agent, agent_ata, USDC),
        LeashError::Unauthorized,
    );

    let v = env.vault_state();
    assert!(!v.revoked);
    assert_eq!(v.per_tx_max, 25 * CENT);
    assert_eq!(env.balance(&env.vault_ata), 5 * USDC);
    assert_eq!(env.balance(&agent_ata), 0);
}

#[test]
fn withdraw_goes_only_to_the_owner() {
    let mut env = Env::demo();
    let owner = env.owner.insecure_clone();

    // Owner signs, but the destination belongs to someone else.
    assert!(env.withdraw(&owner, env.weather_ata, USDC).is_err());
    assert_leash_err(
        env.withdraw(&owner, env.owner_ata, 0),
        LeashError::InvalidAmount,
    );

    env.withdraw(&owner, env.owner_ata, USDC).unwrap();
    assert_eq!(env.balance(&env.vault_ata), 4 * USDC);
    assert_eq!(env.balance(&env.weather_ata), 0);
}

// ---------- update_policy ----------

#[test]
fn owner_can_update_policy() {
    let mut env = Env::demo();
    let owner = env.owner.insecure_clone();
    let shop = Keypair::new();
    let shop_ata = env.ata(&shop.pubkey());
    env.pay(5 * CENT, env.weather_ata).unwrap();

    let policy = Policy {
        per_tx_max: 2 * USDC,
        daily_cap: 3 * USDC,
        allowlist: vec![shop.pubkey()],
        expires_at: START_TS + DAY,
    };
    env.update_policy(&owner, &policy).unwrap();

    let v = env.vault_state();
    assert_eq!(v.per_tx_max, 2 * USDC);
    assert_eq!(v.daily_cap, 3 * USDC);
    assert_eq!(v.allowlist_len, 1);
    assert_eq!(v.allowlist[0], shop.pubkey());
    assert_eq!(v.allowlist[1], Pubkey::default());
    assert_eq!(v.expires_at, START_TS + DAY);
    assert_eq!(v.spent_today, 5 * CENT, "today's spending is kept");

    env.pay(2 * USDC, shop_ata).unwrap();
    assert_eq!(env.balance(&shop_ata), 2 * USDC);
    // The weather service was dropped from the allowlist.
    assert_leash_err(
        env.pay(5 * CENT, env.weather_ata),
        LeashError::RecipientNotAllowed,
    );
}

// ---------- order of checks ----------

/// Each call breaks the rule under test and every later rule at once;
/// the program must report the earliest one.
#[test]
fn rules_are_checked_in_spec_order() {
    let mut env = Env::demo();
    let owner = env.owner.insecure_clone();
    let stranger = Keypair::new();
    let stranger_ata = env.ata(&stranger.pubkey());
    let expires_at = env.vault_state().expires_at;

    env.set_time(expires_at);
    assert_leash_err(env.pay(0, stranger_ata), LeashError::PolicyExpired);
    env.set_time(START_TS);

    assert_leash_err(env.pay(0, stranger_ata), LeashError::InvalidAmount);
    assert_leash_err(
        env.pay(3 * USDC, stranger_ata),
        LeashError::ExceedsPerTxLimit,
    );

    for _ in 0..4 {
        env.pay(25 * CENT, env.weather_ata).unwrap();
    }
    assert_leash_err(env.pay(5 * CENT, stranger_ata), LeashError::ExceedsDailyCap);

    env.revoke(&owner).unwrap();
    env.set_time(expires_at);
    assert_leash_err(env.pay(0, stranger_ata), LeashError::VaultRevoked);
}
