use crate::constants::CONFIG;
use crate::errors::Error;
use crate::state::Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetAuthority<'info> {
    #[account(mut, has_one = authority @ Error::NotConfigAuthority, seeds = [CONFIG.as_bytes()], bump)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<SetAuthority>,
    authority: Option<Pubkey>,
    buy_burn_authority: Option<Pubkey>,
) -> Result<()> {
    if let Some(key) = authority {
        ctx.accounts.config.set_authority(key);
    }
    if let Some(key) = buy_burn_authority {
        ctx.accounts.config.set_buy_burn_authority(key);
    }
    Ok(())
}
