//! STAKE Arena match escrow.
//!
//! Each head-to-head match gets a program-owned `MatchEscrow` account (PDA of the match id)
//! and a token vault (PDA token account whose authority is the escrow PDA). Players deposit
//! exactly one stake each; a designated adjudicator attests the result; the program pays out.
//! No instruction lets any party withdraw vault funds to an arbitrary destination: every
//! transfer out of the vault goes to a token account owned by one of the two bound players.
//!
//! DEVNET / TEST TOKENS ONLY. This is a hackathon prototype and has not been audited.

pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("4CGHpkEjVe6PAZC5V2cpNH2u1kakXQUxru4CSpnarCZL");

#[program]
pub mod stake_arena {
    use super::*;

    pub fn create_match(ctx: Context<CreateMatch>, args: CreateMatchArgs) -> Result<()> {
        instructions::create_match::handle_create_match(ctx, args)
    }

    pub fn deposit(ctx: Context<Deposit>) -> Result<()> {
        instructions::deposit::handle_deposit(ctx)
    }

    pub fn settle(ctx: Context<Payout>, outcome: u8) -> Result<()> {
        instructions::payout::handle_settle(ctx, outcome)
    }

    pub fn cancel_unfunded(ctx: Context<Payout>) -> Result<()> {
        instructions::payout::handle_cancel_unfunded(ctx)
    }

    pub fn refund_unresolved(ctx: Context<Payout>) -> Result<()> {
        instructions::payout::handle_refund_unresolved(ctx)
    }
}
