use anchor_lang::prelude::*;

pub const MATCH_SEED: &[u8] = b"match";
pub const VAULT_SEED: &[u8] = b"vault";

pub const MIN_FUNDING_WINDOW_SECS: i64 = 30;
pub const MAX_FUNDING_WINDOW_SECS: i64 = 24 * 60 * 60;
pub const MIN_RESOLUTION_WINDOW_SECS: i64 = 60;
pub const MAX_RESOLUTION_WINDOW_SECS: i64 = 7 * 24 * 60 * 60;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MatchState {
    AwaitingDeposits,
    Funded,
    Settled,
    Cancelled,
    Refunded,
}

pub const OUTCOME_NONE: u8 = 0;
pub const OUTCOME_PLAYER_ONE: u8 = 1;
pub const OUTCOME_PLAYER_TWO: u8 = 2;
pub const OUTCOME_DRAW: u8 = 3;

#[account]
#[derive(InitSpace)]
pub struct MatchEscrow {
    /// Off-chain match UUID (16 bytes). Also the PDA seed, so ids can never be reused.
    pub match_id: [u8; 16],
    /// Paid rent for the escrow + vault; receives the vault's rent when it is closed.
    pub creator: Pubkey,
    /// The only key allowed to attest a result.
    pub adjudicator: Pubkey,
    pub player_one: Pubkey,
    pub player_two: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    /// Stake per player, in mint base units.
    pub stake: u64,
    pub funding_deadline: i64,
    pub resolution_window: i64,
    pub funded_at: i64,
    pub player_one_deposited: bool,
    pub player_two_deposited: bool,
    pub state: MatchState,
    pub outcome: u8,
    pub bump: u8,
    pub vault_bump: u8,
}

#[event]
pub struct MatchCreated {
    pub escrow: Pubkey,
    pub match_id: [u8; 16],
    pub player_one: Pubkey,
    pub player_two: Pubkey,
    pub mint: Pubkey,
    pub stake: u64,
    pub funding_deadline: i64,
}

#[event]
pub struct StakeDeposited {
    pub escrow: Pubkey,
    pub player: Pubkey,
    pub fully_funded: bool,
}

#[event]
pub struct MatchClosed {
    pub escrow: Pubkey,
    pub state: MatchState,
    pub outcome: u8,
    pub player_one_amount: u64,
    pub player_two_amount: u64,
}
