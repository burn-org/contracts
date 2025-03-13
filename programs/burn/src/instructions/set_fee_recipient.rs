use crate::constants::CONFIG;
use crate::errors::Error;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetFeeRecipient<'info> {
    #[account(mut, has_one = authority @ Error::NotConfigAuthority, seeds = [CONFIG.as_bytes()], bump)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetFeeRecipient>, fee_recipient: Pubkey) -> Result<()> {
    ctx.accounts.config.set_fee_recipient(fee_recipient);
    Ok(())
}
