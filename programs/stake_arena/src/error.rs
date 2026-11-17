use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Players must be two distinct wallets")]
    SamePlayer,
    #[msg("The adjudicator cannot be a player in the match")]
    AdjudicatorIsPlayer,
    #[msg("Stake must be greater than zero")]
    ZeroStake,
    #[msg("Window is outside the allowed range")]
    InvalidWindow,
    #[msg("Signer is not a player in this match")]
    NotAPlayer,
    #[msg("This player has already deposited")]
    AlreadyDeposited,
    #[msg("The match is not accepting deposits")]
    NotAcceptingDeposits,
    #[msg("The funding deadline has passed")]
    FundingExpired,
    #[msg("The match is not fully funded")]
    NotFunded,
    #[msg("Invalid outcome")]
    InvalidOutcome,
    #[msg("Only the adjudicator can do this before the deadline")]
    TooEarly,
    #[msg("Signer is not the match adjudicator")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
}
