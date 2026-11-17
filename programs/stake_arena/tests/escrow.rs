//! Escrow program tests on LiteSVM (in-process SVM with the real SPL Token program).
//! Run with `anchor build && cargo test -p stake_arena`.

use {
    anchor_lang::{
        prelude::Pubkey, solana_program::system_program, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_clock::Clock,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    stake_arena::{
        state::{MatchEscrow, MatchState, MATCH_SEED, VAULT_SEED},
        CreateMatchArgs,
    },
};

const STAKE: u64 = 10_000_000; // 10 TEST at 6 decimals
const START_BALANCE: u64 = 100_000_000;
const TOKEN_PROGRAM: Pubkey = anchor_spl::token::ID;

// ---------- raw SPL account helpers (avoid a second spl-token crate version) ----------

fn mint_data(authority: &Pubkey) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes());
    d[4..36].copy_from_slice(authority.as_ref());
    d[36..44].copy_from_slice(&1_000_000_000_000u64.to_le_bytes());
    d[44] = 6; // decimals
    d[45] = 1; // initialized
    d
}

fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // AccountState::Initialized
    d
}

fn token_balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let acc = svm.get_account(account).expect("token account");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

struct Env {
    svm: LiteSVM,
    mint: Pubkey,
    other_mint: Pubkey,
    adjudicator: Keypair,
    p1: Keypair,
    p2: Keypair,
    outsider: Keypair,
    p1_token: Pubkey,
    p2_token: Pubkey,
    outsider_token: Pubkey,
    p1_wrong_mint_token: Pubkey,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/stake_arena.so"));
        svm.add_program(stake_arena::id(), bytes).unwrap();

        let adjudicator = Keypair::new();
        let (p1, p2, outsider) = (Keypair::new(), Keypair::new(), Keypair::new());
        for kp in [&adjudicator, &p1, &p2, &outsider] {
            svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        }
        let mint = Pubkey::new_unique();
        let other_mint = Pubkey::new_unique();
        for m in [mint, other_mint] {
            set_token_owned(&mut svm, m, mint_data(&Pubkey::new_unique()));
        }
        let mk = |svm: &mut LiteSVM, mint: &Pubkey, owner: &Pubkey| {
            let addr = Pubkey::new_unique();
            set_token_owned(svm, addr, token_account_data(mint, owner, START_BALANCE));
            addr
        };
        let p1_token = mk(&mut svm, &mint, &p1.pubkey());
        let p2_token = mk(&mut svm, &mint, &p2.pubkey());
        let outsider_token = mk(&mut svm, &mint, &outsider.pubkey());
        let p1_wrong_mint_token = mk(&mut svm, &other_mint, &p1.pubkey());
        Env { svm, mint, other_mint, adjudicator, p1, p2, outsider, p1_token, p2_token, outsider_token, p1_wrong_mint_token }
    }

    fn pdas(match_id: [u8; 16]) -> (Pubkey, Pubkey) {
        let (escrow, _) = Pubkey::find_program_address(&[MATCH_SEED, &match_id], &stake_arena::id());
        let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED, escrow.as_ref()], &stake_arena::id());
        (escrow, vault)
    }

    fn send(&mut self, ix: anchor_lang::solana_program::instruction::Instruction, signers: &[&Keypair]) -> Result<(), String> {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&signers[0].pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        self.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err))
    }

    fn create_ix(&self, match_id: [u8; 16], p1: Pubkey, p2: Pubkey, adjudicator: Pubkey) -> anchor_lang::solana_program::instruction::Instruction {
        let (escrow, vault) = Self::pdas(match_id);
        anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            stake_arena::id(),
            &stake_arena::instruction::CreateMatch {
                args: CreateMatchArgs {
                    match_id,
                    player_one: p1,
                    player_two: p2,
                    stake: STAKE,
                    funding_window_secs: 120,
                    resolution_window_secs: 3600,
                },
            }
            .data(),
            stake_arena::accounts::CreateMatch {
                creator: adjudicator,
                adjudicator,
                mint: self.mint,
                escrow,
                vault,
                token_program: TOKEN_PROGRAM,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn create(&mut self, match_id: [u8; 16]) -> Result<(), String> {
        let ix = self.create_ix(match_id, self.p1.pubkey(), self.p2.pubkey(), self.adjudicator.pubkey());
        let adj = self.adjudicator.insecure_clone();
        self.send(ix, &[&adj])
    }

    fn deposit_ix(&self, match_id: [u8; 16], player: Pubkey, player_token: Pubkey, mint: Pubkey) -> anchor_lang::solana_program::instruction::Instruction {
        let (escrow, vault) = Self::pdas(match_id);
        anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            stake_arena::id(),
            &stake_arena::instruction::Deposit {}.data(),
            stake_arena::accounts::Deposit { player, escrow, player_token, vault, mint, token_program: TOKEN_PROGRAM }
                .to_account_metas(None),
        )
    }

    fn deposit(&mut self, match_id: [u8; 16], who: u8) -> Result<(), String> {
        let (kp, token) = match who {
            1 => (self.p1.insecure_clone(), self.p1_token),
            2 => (self.p2.insecure_clone(), self.p2_token),
            _ => (self.outsider.insecure_clone(), self.outsider_token),
        };
        let ix = self.deposit_ix(match_id, kp.pubkey(), token, self.mint);
        self.send(ix, &[&kp])
    }

    fn payout_ix(&self, match_id: [u8; 16], caller: Pubkey, ix_data: Vec<u8>, p1_token: Pubkey, p2_token: Pubkey) -> anchor_lang::solana_program::instruction::Instruction {
        let (escrow, vault) = Self::pdas(match_id);
        anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            stake_arena::id(),
            &ix_data,
            stake_arena::accounts::Payout {
                caller,
                escrow,
                vault,
                mint: self.mint,
                player_one_token: p1_token,
                player_two_token: p2_token,
                creator: self.adjudicator.pubkey(),
                token_program: TOKEN_PROGRAM,
            }
            .to_account_metas(None),
        )
    }

    fn payout(&mut self, match_id: [u8; 16], caller: &Keypair, data: Vec<u8>) -> Result<(), String> {
        let ix = self.payout_ix(match_id, caller.pubkey(), data, self.p1_token, self.p2_token);
        self.send(ix, &[caller])
    }

    fn settle(&mut self, match_id: [u8; 16], caller: &Keypair, outcome: u8) -> Result<(), String> {
        self.payout(match_id, caller, stake_arena::instruction::Settle { outcome }.data())
    }

    fn escrow(&self, match_id: [u8; 16]) -> MatchEscrow {
        let acc = self.svm.get_account(&Self::pdas(match_id).0).unwrap();
        MatchEscrow::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn warp(&mut self, secs: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }

    fn funded(&mut self, match_id: [u8; 16]) {
        self.create(match_id).unwrap();
        self.deposit(match_id, 1).unwrap();
        self.deposit(match_id, 2).unwrap();
    }
}

fn set_token_owned(svm: &mut LiteSVM, addr: Pubkey, data: Vec<u8>) {
    svm.set_account(addr, Account { lamports: 10_000_000, data, owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 })
        .unwrap();
}

fn id(n: u8) -> [u8; 16] {
    let mut b = [0u8; 16];
    b[0] = n;
    b[15] = 0xAB;
    b
}

// ------------------------------------------------------------------------------------

#[test]
fn deposits_fund_the_match() {
    let mut e = Env::new();
    let m = id(1);
    e.create(m).unwrap();
    assert_eq!(e.escrow(m).state, MatchState::AwaitingDeposits);
    e.deposit(m, 1).unwrap();
    assert_eq!(e.escrow(m).state, MatchState::AwaitingDeposits);
    e.deposit(m, 2).unwrap();
    let s = e.escrow(m);
    assert_eq!(s.state, MatchState::Funded);
    assert!(s.player_one_deposited && s.player_two_deposited);
    assert_eq!(token_balance(&e.svm, &Env::pdas(m).1), 2 * STAKE);
    assert_eq!(token_balance(&e.svm, &e.p1_token), START_BALANCE - STAKE);
}

#[test]
fn wrong_mint_deposit_fails() {
    let mut e = Env::new();
    let m = id(2);
    e.create(m).unwrap();
    // player's account of a different mint
    let ix = e.deposit_ix(m, e.p1.pubkey(), e.p1_wrong_mint_token, e.mint);
    let p1 = e.p1.insecure_clone();
    assert!(e.send(ix, &[&p1]).is_err());
    // passing the other mint itself is rejected by has_one = mint
    let ix = e.deposit_ix(m, e.p1.pubkey(), e.p1_wrong_mint_token, e.other_mint);
    assert!(e.send(ix, &[&p1]).is_err());
    assert!(!e.escrow(m).player_one_deposited);
}

#[test]
fn deposit_amount_is_fixed_and_requires_balance() {
    // The amount is not an instruction argument: the program always moves exactly `stake`.
    let mut e = Env::new();
    let m = id(3);
    e.create(m).unwrap();
    let poor = Pubkey::new_unique();
    set_token_owned(&mut e.svm, poor, token_account_data(&e.mint, &e.p1.pubkey(), STAKE - 1));
    let ix = e.deposit_ix(m, e.p1.pubkey(), poor, e.mint);
    let p1 = e.p1.insecure_clone();
    assert!(e.send(ix, &[&p1]).is_err(), "insufficient balance must fail");
    e.deposit(m, 1).unwrap();
    assert_eq!(token_balance(&e.svm, &e.p1_token), START_BALANCE - STAKE);
}

#[test]
fn duplicate_deposit_fails() {
    let mut e = Env::new();
    let m = id(4);
    e.create(m).unwrap();
    e.deposit(m, 1).unwrap();
    assert!(e.deposit(m, 1).is_err());
    assert_eq!(token_balance(&e.svm, &Env::pdas(m).1), STAKE);
}

#[test]
fn outsider_cannot_deposit() {
    let mut e = Env::new();
    let m = id(5);
    e.create(m).unwrap();
    assert!(e.deposit(m, 9).is_err());
}

#[test]
fn deposit_after_deadline_fails() {
    let mut e = Env::new();
    let m = id(6);
    e.create(m).unwrap();
    e.warp(121);
    assert!(e.deposit(m, 1).is_err());
}

#[test]
fn creation_rejects_same_player_and_adjudicator_as_player() {
    let mut e = Env::new();
    let adj = e.adjudicator.insecure_clone();
    let ix = e.create_ix(id(7), e.p1.pubkey(), e.p1.pubkey(), adj.pubkey());
    assert!(e.send(ix, &[&adj]).is_err(), "one wallet cannot hold both seats");
    let ix = e.create_ix(id(8), adj.pubkey(), e.p2.pubkey(), adj.pubkey());
    assert!(e.send(ix, &[&adj]).is_err(), "adjudicator cannot play");
}

#[test]
fn match_id_cannot_be_reused() {
    let mut e = Env::new();
    let m = id(9);
    e.create(m).unwrap();
    assert!(e.create(m).is_err());
}

#[test]
fn winner_receives_entire_pool() {
    let mut e = Env::new();
    let m = id(10);
    e.funded(m);
    let adj = e.adjudicator.insecure_clone();
    e.settle(m, &adj, 2).unwrap();
    assert_eq!(token_balance(&e.svm, &e.p2_token), START_BALANCE + STAKE);
    assert_eq!(token_balance(&e.svm, &e.p1_token), START_BALANCE - STAKE);
    let s = e.escrow(m);
    assert_eq!(s.state, MatchState::Settled);
    assert_eq!(s.outcome, 2);
    assert!(e.svm.get_account(&Env::pdas(m).1).map_or(true, |a| a.lamports == 0), "vault closed");
}

#[test]
fn draw_refunds_both() {
    let mut e = Env::new();
    let m = id(11);
    e.funded(m);
    let adj = e.adjudicator.insecure_clone();
    e.settle(m, &adj, 3).unwrap();
    assert_eq!(token_balance(&e.svm, &e.p1_token), START_BALANCE);
    assert_eq!(token_balance(&e.svm, &e.p2_token), START_BALANCE);
}

#[test]
fn double_settlement_fails() {
    let mut e = Env::new();
    let m = id(12);
    e.funded(m);
    let adj = e.adjudicator.insecure_clone();
    e.settle(m, &adj, 1).unwrap();
    assert!(e.settle(m, &adj, 1).is_err());
    assert!(e.settle(m, &adj, 2).is_err());
    assert_eq!(token_balance(&e.svm, &e.p1_token), START_BALANCE + STAKE);
}

#[test]
fn wrong_adjudicator_and_players_cannot_settle() {
    let mut e = Env::new();
    let m = id(13);
    e.funded(m);
    for kp in [e.p1.insecure_clone(), e.p2.insecure_clone(), e.outsider.insecure_clone()] {
        assert!(e.settle(m, &kp, 1).is_err());
    }
    assert_eq!(e.escrow(m).state, MatchState::Funded);
}

#[test]
fn settlement_before_funding_fails_and_invalid_outcome_fails() {
    let mut e = Env::new();
    let m = id(14);
    e.create(m).unwrap();
    e.deposit(m, 1).unwrap();
    let adj = e.adjudicator.insecure_clone();
    assert!(e.settle(m, &adj, 1).is_err());
    e.deposit(m, 2).unwrap();
    assert!(e.settle(m, &adj, 0).is_err());
    assert!(e.settle(m, &adj, 4).is_err());
}

#[test]
fn vault_cannot_be_redirected() {
    let mut e = Env::new();
    let m = id(15);
    e.funded(m);
    let adj = e.adjudicator.insecure_clone();
    // Even the adjudicator cannot route the pool to a token account the winner does not own.
    let ix = e.payout_ix(m, adj.pubkey(), stake_arena::instruction::Settle { outcome: 1 }.data(), e.outsider_token, e.p2_token);
    assert!(e.send(ix, &[&adj]).is_err());
    assert_eq!(token_balance(&e.svm, &Env::pdas(m).1), 2 * STAKE);
    assert_eq!(token_balance(&e.svm, &e.outsider_token), START_BALANCE);
}

#[test]
fn unfunded_match_cancel_is_time_gated_and_refunds() {
    let mut e = Env::new();
    let m = id(16);
    e.create(m).unwrap();
    e.deposit(m, 1).unwrap();
    let outsider = e.outsider.insecure_clone();
    let cancel = stake_arena::instruction::CancelUnfunded {}.data();
    assert!(e.payout(m, &outsider, cancel.clone()).is_err(), "too early for non-adjudicator");
    e.warp(121);
    e.payout(m, &outsider, cancel.clone()).unwrap();
    assert_eq!(e.escrow(m).state, MatchState::Cancelled);
    assert_eq!(token_balance(&e.svm, &e.p1_token), START_BALANCE);
    assert!(e.payout(m, &outsider, cancel).is_err(), "terminal");
    assert!(e.deposit(m, 2).is_err());
}

#[test]
fn adjudicator_can_cancel_unfunded_early() {
    let mut e = Env::new();
    let m = id(17);
    e.create(m).unwrap();
    e.deposit(m, 2).unwrap();
    let adj = e.adjudicator.insecure_clone();
    e.payout(m, &adj, stake_arena::instruction::CancelUnfunded {}.data()).unwrap();
    assert_eq!(token_balance(&e.svm, &e.p2_token), START_BALANCE);
}

#[test]
fn funded_match_cannot_be_cancelled_as_unfunded() {
    let mut e = Env::new();
    let m = id(18);
    e.funded(m);
    e.warp(1000);
    let p1 = e.p1.insecure_clone();
    assert!(e.payout(m, &p1, stake_arena::instruction::CancelUnfunded {}.data()).is_err());
}

#[test]
fn unresolved_refund_is_time_gated() {
    let mut e = Env::new();
    let m = id(19);
    e.funded(m);
    let loser = e.p1.insecure_clone();
    let refund = stake_arena::instruction::RefundUnresolved {}.data();
    assert!(e.payout(m, &loser, refund.clone()).is_err(), "losing player cannot refund early");
    e.warp(3599);
    assert!(e.payout(m, &loser, refund.clone()).is_err());
    e.warp(2);
    e.payout(m, &loser, refund.clone()).unwrap();
    assert_eq!(e.escrow(m).state, MatchState::Refunded);
    assert_eq!(token_balance(&e.svm, &e.p1_token), START_BALANCE);
    assert_eq!(token_balance(&e.svm, &e.p2_token), START_BALANCE);
    let adj = e.adjudicator.insecure_clone();
    assert!(e.settle(m, &adj, 1).is_err(), "no settlement after refund");
    assert!(e.payout(m, &loser, refund).is_err());
}

#[test]
fn donated_dust_does_not_block_settlement() {
    let mut e = Env::new();
    let m = id(20);
    e.funded(m);
    let vault = Env::pdas(m).1;
    let mut acc = e.svm.get_account(&vault).unwrap();
    acc.data[64..72].copy_from_slice(&(2 * STAKE + 1).to_le_bytes());
    e.svm.set_account(vault, acc).unwrap();
    let adj = e.adjudicator.insecure_clone();
    e.settle(m, &adj, 1).unwrap();
    assert_eq!(token_balance(&e.svm, &e.p1_token), START_BALANCE + STAKE);
    assert_eq!(token_balance(&e.svm, &vault), 1);
}
