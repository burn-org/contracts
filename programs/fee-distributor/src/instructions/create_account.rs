use crate::state::Claim;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CreateAccount<'info> {
    #[account(init, payer = payer, space = Claim::LEN,
    seeds = [
        b"owner",
        owner.key().as_ref(),
    ], bump
    )]
    pub claim: Account<'info, Claim>,
    /// CHECK:
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<CreateAccount>) -> Result<()> {
    Ok(())
}
