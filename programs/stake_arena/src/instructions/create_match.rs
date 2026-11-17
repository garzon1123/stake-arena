use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{error::EscrowError, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMatchArgs {
    pub match_id: [u8; 16],
    pub player_one: Pubkey,
    pub player_two: Pubkey,
    pub stake: u64,
    pub funding_window_secs: i64,
    pub resolution_window_secs: i64,
}

#[derive(Accounts)]
#[instruction(args: CreateMatchArgs)]
pub struct CreateMatch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    /// The adjudicator must co-sign so a match can never be bound to an unwilling key.
    pub adjudicator: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        space = 8 + MatchEscrow::INIT_SPACE,
        seeds = [MATCH_SEED, args.match_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, MatchEscrow>,
    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_match(ctx: Context<CreateMatch>, args: CreateMatchArgs) -> Result<()> {
    require_keys_neq!(args.player_one, args.player_two, EscrowError::SamePlayer);
    let adjudicator = ctx.accounts.adjudicator.key();
    require!(
        adjudicator != args.player_one && adjudicator != args.player_two,
        EscrowError::AdjudicatorIsPlayer
    );
    require!(args.stake > 0, EscrowError::ZeroStake);
    require!(
        (MIN_FUNDING_WINDOW_SECS..=MAX_FUNDING_WINDOW_SECS).contains(&args.funding_window_secs),
        EscrowError::InvalidWindow
    );
    require!(
        (MIN_RESOLUTION_WINDOW_SECS..=MAX_RESOLUTION_WINDOW_SECS)
            .contains(&args.resolution_window_secs),
        EscrowError::InvalidWindow
    );
    // Total pool must be representable.
    args.stake.checked_mul(2).ok_or(EscrowError::Overflow)?;

    let now = Clock::get()?.unix_timestamp;
    let escrow = &mut ctx.accounts.escrow;
    escrow.match_id = args.match_id;
    escrow.creator = ctx.accounts.creator.key();
    escrow.adjudicator = adjudicator;
    escrow.player_one = args.player_one;
    escrow.player_two = args.player_two;
    escrow.mint = ctx.accounts.mint.key();
    escrow.vault = ctx.accounts.vault.key();
    escrow.stake = args.stake;
    escrow.funding_deadline = now
        .checked_add(args.funding_window_secs)
        .ok_or(EscrowError::Overflow)?;
    escrow.resolution_window = args.resolution_window_secs;
    escrow.funded_at = 0;
    escrow.player_one_deposited = false;
    escrow.player_two_deposited = false;
    escrow.state = MatchState::AwaitingDeposits;
    escrow.outcome = OUTCOME_NONE;
    escrow.bump = ctx.bumps.escrow;
    escrow.vault_bump = ctx.bumps.vault;

    emit!(MatchCreated {
        escrow: escrow.key(),
        match_id: escrow.match_id,
        player_one: escrow.player_one,
        player_two: escrow.player_two,
        mint: escrow.mint,
        stake: escrow.stake,
        funding_deadline: escrow.funding_deadline,
    });
    Ok(())
}
