use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::{error::EscrowError, state::*};

/// Shared account set for every instruction that moves funds out of the vault.
/// Payout destinations are constrained to token accounts owned by the bound players,
/// so no caller (including the adjudicator) can redirect funds.
#[derive(Accounts)]
pub struct Payout<'info> {
    /// Adjudicator for `settle`; any signer for the time-gated recovery paths.
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [MATCH_SEED, escrow.match_id.as_ref()],
        bump = escrow.bump,
        has_one = mint,
        has_one = vault,
        has_one = creator,
    )]
    pub escrow: Account<'info, MatchEscrow>,
    #[account(mut, seeds = [VAULT_SEED, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = escrow.player_one)]
    pub player_one_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = escrow.player_two)]
    pub player_two_token: Account<'info, TokenAccount>,
    /// CHECK: bound by `has_one = creator`; only receives the vault's rent lamports.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_settle(ctx: Context<Payout>, outcome: u8) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    require_keys_eq!(
        ctx.accounts.caller.key(),
        escrow.adjudicator,
        EscrowError::Unauthorized
    );
    require!(escrow.state == MatchState::Funded, EscrowError::NotFunded);
    let pool = escrow.stake.checked_mul(2).ok_or(EscrowError::Overflow)?;
    let (one, two) = match outcome {
        OUTCOME_PLAYER_ONE => (pool, 0),
        OUTCOME_PLAYER_TWO => (0, pool),
        OUTCOME_DRAW => (escrow.stake, escrow.stake),
        _ => return err!(EscrowError::InvalidOutcome),
    };
    pay_out_and_close(&ctx, one, two)?;
    let escrow = &mut ctx.accounts.escrow;
    escrow.state = MatchState::Settled;
    escrow.outcome = outcome;
    emit!(MatchClosed {
        escrow: escrow.key(),
        state: escrow.state,
        outcome,
        player_one_amount: one,
        player_two_amount: two,
    });
    Ok(())
}

/// Permissionless after the funding deadline (adjudicator may cancel earlier).
/// Returns whatever each player actually deposited.
pub fn handle_cancel_unfunded(ctx: Context<Payout>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    require!(
        escrow.state == MatchState::AwaitingDeposits,
        EscrowError::NotAcceptingDeposits
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= escrow.funding_deadline || ctx.accounts.caller.key() == escrow.adjudicator,
        EscrowError::TooEarly
    );
    let one = if escrow.player_one_deposited { escrow.stake } else { 0 };
    let two = if escrow.player_two_deposited { escrow.stake } else { 0 };
    pay_out_and_close(&ctx, one, two)?;
    let escrow = &mut ctx.accounts.escrow;
    escrow.state = MatchState::Cancelled;
    emit!(MatchClosed {
        escrow: escrow.key(),
        state: escrow.state,
        outcome: OUTCOME_NONE,
        player_one_amount: one,
        player_two_amount: two,
    });
    Ok(())
}

/// Recovery for a funded match the adjudicator never settled. Permissionless once
/// `funded_at + resolution_window` has passed, so neither player can trigger it early
/// (the adjudicator may abort earlier, which is no more power than settling a draw).
pub fn handle_refund_unresolved(ctx: Context<Payout>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    require!(escrow.state == MatchState::Funded, EscrowError::NotFunded);
    let now = Clock::get()?.unix_timestamp;
    let unlock = escrow
        .funded_at
        .checked_add(escrow.resolution_window)
        .ok_or(EscrowError::Overflow)?;
    require!(
        now >= unlock || ctx.accounts.caller.key() == escrow.adjudicator,
        EscrowError::TooEarly
    );
    let stake = escrow.stake;
    pay_out_and_close(&ctx, stake, stake)?;
    let escrow = &mut ctx.accounts.escrow;
    escrow.state = MatchState::Refunded;
    emit!(MatchClosed {
        escrow: escrow.key(),
        state: escrow.state,
        outcome: OUTCOME_NONE,
        player_one_amount: stake,
        player_two_amount: stake,
    });
    Ok(())
}

fn pay_out_and_close(ctx: &Context<Payout>, one: u64, two: u64) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let bump = [escrow.bump];
    let seeds: &[&[u8]] = &[MATCH_SEED, escrow.match_id.as_ref(), &bump];
    let signer = &[seeds];
    let decimals = ctx.accounts.mint.decimals;

    for (amount, dest) in [
        (one, &ctx.accounts.player_one_token),
        (two, &ctx.accounts.player_two_token),
    ] {
        if amount == 0 {
            continue;
        }
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: dest.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer,
            ),
            amount,
            decimals,
        )?;
    }

    // Close the vault to return rent, unless someone donated extra tokens to it
    // (closing a non-empty token account fails, and that must not block payouts).
    let remaining = ctx
        .accounts
        .vault
        .amount
        .checked_sub(one.checked_add(two).ok_or(EscrowError::Overflow)?)
        .ok_or(EscrowError::Overflow)?;
    if remaining == 0 {
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.creator.to_account_info(),
                authority: escrow.to_account_info(),
            },
            signer,
        ))?;
    }
    Ok(())
}
