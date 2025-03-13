use crate::errors::Error;
use crate::state::claim::Claim;
use crate::state::vault::Vault;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateClaim<'info> {
    #[account(mut, has_one = authority @ Error::MissingAuthority)]
    pub vault: Account<'info, Vault>,

    #[account(mut,
        seeds = [
            b"owner", 
            owner.key().as_ref()
        ], bump)]
    pub claim: Account<'info, Claim>,
    pub authority: Signer<'info>,
    pub owner: Signer<'info>,
    /// CHECK:
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateClaimArgs {
    pub next_nonce: u32,
    pub next_claimed: u64,
}

pub fn handler(ctx: Context<UpdateClaim>, args: UpdateClaimArgs) -> Result<()> {
    let delta = ctx.accounts.claim.update_claim(args.next_nonce, args.next_claimed)?;

    ctx.accounts
        .vault
        .transfer(&ctx.accounts.vault, &ctx.accounts.recipient, delta)
}
