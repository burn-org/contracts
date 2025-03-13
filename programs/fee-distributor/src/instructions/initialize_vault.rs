use crate::state::Vault;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(init, payer = payer, space = Vault::LEN,
        seeds = [
            b"vault"
        ], bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeVaultArgs {
    pub authority: Pubkey,
}

pub fn handler(ctx: Context<InitializeVault>, args: InitializeVaultArgs) -> Result<()> {
    ctx.accounts.vault.initialize(args.authority, &ctx.program_id);
    Ok(())
}
