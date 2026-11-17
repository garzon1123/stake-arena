use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{error::EscrowError, state::*};

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [MATCH_SEED, escrow.match_id.as_ref()],
        bump = escrow.bump,
        has_one = mint,
        has_one = vault,
    )]
    pub escrow: Account<'info, MatchEscrow>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = player,
    )]
    pub player_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_deposit(ctx: Context<Deposit>) -> Result<()> {
    let player = ctx.accounts.player.key();
    let escrow = &ctx.accounts.escrow;
    require!(
        escrow.state == MatchState::AwaitingDeposits,
        EscrowError::NotAcceptingDeposits
    );
    let now = Clock::get()?.unix_timestamp;
    require!(now < escrow.funding_deadline, EscrowError::FundingExpired);

    let is_one = player == escrow.player_one;
    let is_two = player == escrow.player_two;
    require!(is_one || is_two, EscrowError::NotAPlayer);
    if is_one {
        require!(!escrow.player_one_deposited, EscrowError::AlreadyDeposited);
    } else {
        require!(!escrow.player_two_deposited, EscrowError::AlreadyDeposited);
    }

    let stake = escrow.stake;
    let decimals = ctx.accounts.mint.decimals;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.player_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        ),
        stake,
        decimals,
    )?;

    let escrow = &mut ctx.accounts.escrow;
    if is_one {
        escrow.player_one_deposited = true;
    } else {
        escrow.player_two_deposited = true;
    }
    let fully_funded = escrow.player_one_deposited && escrow.player_two_deposited;
    if fully_funded {
        escrow.state = MatchState::Funded;
        escrow.funded_at = now;
    }

    emit!(StakeDeposited { escrow: escrow.key(), player, fully_funded });
    Ok(())
}
