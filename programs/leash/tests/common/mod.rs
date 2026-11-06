//! Test harness: a LiteSVM chain with the Leash program, a 6-decimal test mint
//! and helpers that send each instruction and check errors by name.
#![allow(dead_code)]
// LiteSVM's error type is large by design; fine in tests.
#![allow(clippy::result_large_err)]

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{
            instruction::{error::InstructionError, Instruction},
            system_program,
        },
        AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
    },
    anchor_spl::associated_token::{self, get_associated_token_address_with_program_id},
    base64::{engine::general_purpose::STANDARD as BASE64, Engine},
    leash::{error::LeashError, events::PaymentEvent, state::Vault, VAULT_SEED},
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    litesvm_token::{
        get_spl_account, spl_token, CreateAssociatedTokenAccount, CreateMint, MintTo, TOKEN_ID,
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_transaction_error::TransactionError,
};

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

/// $1 in USDC base units (6 decimals).
pub const USDC: u64 = 1_000_000;
/// $0.01 in USDC base units.
pub const CENT: u64 = 10_000;
pub const DECIMALS: u8 = 6;
pub const DAY: i64 = 86_400;
/// 2026-11-07 12:00:00 UTC. Tests start at noon so they never cross midnight by accident.
pub const START_TS: i64 = 1_794_009_600 + 12 * 3600;

#[derive(Clone)]
pub struct Policy {
    pub per_tx_max: u64,
    pub daily_cap: u64,
    pub allowlist: Vec<Pubkey>,
    pub expires_at: i64,
}

pub struct Env {
    pub svm: LiteSVM,
    pub owner: Keypair,
    pub agent: Keypair,
    pub mint: Pubkey,
    pub owner_ata: Pubkey,
    /// Two allowlisted service wallets, as in the demo.
    pub weather: Keypair,
    pub translate: Keypair,
    pub weather_ata: Pubkey,
    pub translate_ata: Pubkey,
    pub vault: Pubkey,
    pub vault_ata: Pubkey,
}

impl Env {
    /// Fresh chain: program loaded, clock at START_TS, test USDC mint, owner holds $100.
    /// No vault yet.
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/leash.so"));
        svm.add_program(leash::id(), bytes).unwrap();

        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = START_TS;
        svm.set_sysvar(&clock);

        let owner = Keypair::new();
        let agent = Keypair::new();
        let weather = Keypair::new();
        let translate = Keypair::new();
        svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&agent.pubkey(), 1_000_000_000).unwrap();

        let mint = CreateMint::new(&mut svm, &owner)
            .decimals(DECIMALS)
            .send()
            .unwrap();
        let owner_ata = create_ata(&mut svm, &owner, &owner.pubkey(), &mint);
        MintTo::new(&mut svm, &owner, &mint, &owner_ata, 100 * USDC)
            .send()
            .unwrap();
        let weather_ata = create_ata(&mut svm, &owner, &weather.pubkey(), &mint);
        let translate_ata = create_ata(&mut svm, &owner, &translate.pubkey(), &mint);

        let vault = Pubkey::find_program_address(
            &[VAULT_SEED, owner.pubkey().as_ref(), agent.pubkey().as_ref()],
            &leash::id(),
        )
        .0;
        let vault_ata = get_associated_token_address_with_program_id(&vault, &mint, &TOKEN_ID);

        Env {
            svm,
            owner,
            agent,
            mint,
            owner_ata,
            weather,
            translate,
            weather_ata,
            translate_ata,
            vault,
            vault_ata,
        }
    }

    /// The demo setup: $0.25 per payment, $1 per day, two services allowlisted,
    /// valid for 30 days, $5 deposited.
    pub fn demo() -> Self {
        let mut env = Self::new();
        let policy = env.demo_policy();
        env.create_vault(&policy).unwrap();
        env.deposit(5 * USDC).unwrap();
        env
    }

    pub fn demo_policy(&self) -> Policy {
        Policy {
            per_tx_max: 25 * CENT,
            daily_cap: USDC,
            allowlist: vec![self.weather.pubkey(), self.translate.pubkey()],
            expires_at: START_TS + 30 * DAY,
        }
    }

    // ---------- clock ----------

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }

    // ---------- accounts ----------

    /// A new funded wallet (has SOL for fees, no tokens).
    pub fn new_wallet(&mut self) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 1_000_000_000).unwrap();
        kp
    }

    /// Creates the ATA of `wallet` for the test mint.
    pub fn ata(&mut self, wallet: &Pubkey) -> Pubkey {
        let mint = self.mint;
        create_ata(&mut self.svm, &self.owner, wallet, &mint)
    }

    /// Mints test USDC to any token account.
    pub fn mint_to(&mut self, token_account: &Pubkey, amount: u64) {
        let mint = self.mint;
        MintTo::new(&mut self.svm, &self.owner, &mint, token_account, amount)
            .send()
            .unwrap();
    }

    pub fn balance(&self, token_account: &Pubkey) -> u64 {
        get_spl_account::<spl_token::state::Account>(&self.svm, token_account)
            .unwrap()
            .amount
    }

    pub fn vault_state(&self) -> Vault {
        let account = self.svm.get_account(&self.vault).expect("vault exists");
        Vault::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    // ---------- instructions ----------

    pub fn create_vault(&mut self, policy: &Policy) -> TxResult {
        let ix = Instruction::new_with_bytes(
            leash::id(),
            &leash::instruction::CreateVault {
                per_tx_max: policy.per_tx_max,
                daily_cap: policy.daily_cap,
                allowlist: policy.allowlist.clone(),
                expires_at: policy.expires_at,
            }
            .data(),
            leash::accounts::CreateVault {
                owner: self.owner.pubkey(),
                agent: self.agent.pubkey(),
                mint: self.mint,
                vault: self.vault,
                vault_token_account: self.vault_ata,
                token_program: TOKEN_ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, ix, &self.owner)
    }

    /// Owner tops up the vault from their own token account.
    pub fn deposit(&mut self, amount: u64) -> TxResult {
        let owner = self.owner.insecure_clone();
        self.deposit_from(&owner, self.owner_ata, amount)
    }

    pub fn deposit_from(&mut self, depositor: &Keypair, from: Pubkey, amount: u64) -> TxResult {
        let ix = Instruction::new_with_bytes(
            leash::id(),
            &leash::instruction::Deposit { amount }.data(),
            leash::accounts::Deposit {
                depositor: depositor.pubkey(),
                vault: self.vault,
                mint: self.mint,
                depositor_token_account: from,
                vault_token_account: self.vault_ata,
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, ix, depositor)
    }

    pub fn update_policy(&mut self, signer: &Keypair, policy: &Policy) -> TxResult {
        let ix = Instruction::new_with_bytes(
            leash::id(),
            &leash::instruction::UpdatePolicy {
                per_tx_max: policy.per_tx_max,
                daily_cap: policy.daily_cap,
                allowlist: policy.allowlist.clone(),
                expires_at: policy.expires_at,
            }
            .data(),
            leash::accounts::UpdatePolicy {
                owner: signer.pubkey(),
                vault: self.vault,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, ix, signer)
    }

    pub fn revoke(&mut self, signer: &Keypair) -> TxResult {
        let ix = Instruction::new_with_bytes(
            leash::id(),
            &leash::instruction::Revoke {}.data(),
            leash::accounts::Revoke {
                owner: signer.pubkey(),
                vault: self.vault,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, ix, signer)
    }

    pub fn withdraw(&mut self, signer: &Keypair, to: Pubkey, amount: u64) -> TxResult {
        let ix = Instruction::new_with_bytes(
            leash::id(),
            &leash::instruction::Withdraw { amount }.data(),
            leash::accounts::Withdraw {
                owner: signer.pubkey(),
                vault: self.vault,
                mint: self.mint,
                vault_token_account: self.vault_ata,
                owner_token_account: to,
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, ix, signer)
    }

    /// The agent pays `amount` to `recipient_token_account`.
    pub fn pay(&mut self, amount: u64, recipient_token_account: Pubkey) -> TxResult {
        let agent = self.agent.insecure_clone();
        self.pay_as(&agent, amount, recipient_token_account)
    }

    /// `agent_pay` signed by any key, to test that only the agent can pay.
    pub fn pay_as(
        &mut self,
        signer: &Keypair,
        amount: u64,
        recipient_token_account: Pubkey,
    ) -> TxResult {
        self.pay_with(
            signer,
            amount,
            recipient_token_account,
            self.mint,
            intent_hash("test task"),
        )
    }

    pub fn pay_with(
        &mut self,
        signer: &Keypair,
        amount: u64,
        recipient_token_account: Pubkey,
        mint: Pubkey,
        intent_hash: [u8; 32],
    ) -> TxResult {
        let ix = Instruction::new_with_bytes(
            leash::id(),
            &leash::instruction::AgentPay {
                amount,
                intent_hash,
            }
            .data(),
            leash::accounts::AgentPay {
                agent: signer.pubkey(),
                vault: self.vault,
                mint,
                vault_token_account: self.vault_ata,
                recipient_token_account,
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, ix, signer)
    }
}

pub fn create_ata(svm: &mut LiteSVM, payer: &Keypair, wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    CreateAssociatedTokenAccount::new(svm, payer, mint)
        .owner(wallet)
        .send()
        .unwrap()
}

/// Signs and sends one instruction. The blockhash is rotated first so that
/// identical transactions sent twice are not rejected as duplicates.
pub fn send(svm: &mut LiteSVM, ix: Instruction, signer: &Keypair) -> TxResult {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx)
}

/// Test stand-in for sha256(task text): deterministic and distinct per text.
pub fn intent_hash(text: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, b) in text.bytes().enumerate() {
        out[i % 32] ^= b.wrapping_add(i as u8);
    }
    out
}

/// Asserts the transaction failed with this Leash error, by code and by the name in the logs.
#[track_caller]
pub fn assert_leash_err(res: TxResult, expected: LeashError) {
    let name = format!("{expected:?}");
    let code: u32 = expected.into();
    let failed = match res {
        Ok(_) => panic!("expected {name}, but the transaction succeeded"),
        Err(failed) => failed,
    };
    match failed.err {
        TransactionError::InstructionError(_, InstructionError::Custom(c)) if c == code => {}
        ref other => panic!(
            "expected {name} ({code}), got {other:?}\n{}",
            failed.meta.logs.join("\n")
        ),
    }
    let in_logs = failed
        .meta
        .logs
        .iter()
        .any(|l| l.contains(&format!("Error Code: {name}.")));
    assert!(
        in_logs,
        "error name {name} not found in logs:\n{}",
        failed.meta.logs.join("\n")
    );
}

/// Decodes all `PaymentEvent`s from the transaction logs.
pub fn payment_events(meta: &TransactionMetadata) -> Vec<PaymentEvent> {
    meta.logs
        .iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .filter_map(|b64| BASE64.decode(b64).ok())
        .filter(|data| data.starts_with(PaymentEvent::DISCRIMINATOR))
        .map(|data| {
            PaymentEvent::try_from_slice(&data[PaymentEvent::DISCRIMINATOR.len()..]).unwrap()
        })
        .collect()
}
