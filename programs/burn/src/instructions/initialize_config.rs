use crate::state::Config;
use anchor_lang::prelude::*;
use crate::constants::CONFIG;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = payer, space = Config::LEN, 
        seeds = [CONFIG.as_bytes()],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeConfigArgs {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub buy_burn_authority: Pubkey,
}

pub fn handler(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
    ctx.accounts
        .config
        .initialize(args.authority, args.fee_recipient, args.buy_burn_authority);
    Ok(())
}
