use crate::{
    constants::{BURN_ACCOUNT_SEED, CONFIG},
    state::{BurnAccount, Config},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CreateBurnAccount<'info> {
    #[account(seeds = [CONFIG.as_bytes()], bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(init, payer = payer, space = BurnAccount::LEN, seeds = [
        BURN_ACCOUNT_SEED.as_bytes(),
        owner.key().as_ref(),
        config.key().as_ref()
    ], bump)]
    pub burn_account: Account<'info, BurnAccount>,
    /// CHECK:
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<CreateBurnAccount>) -> Result<()> {
    Ok(())
}
