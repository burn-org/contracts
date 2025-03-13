use anchor_lang::prelude::*;

declare_id!("burnfZzJfuR8b8yMRGgZfLAq7P2eCuMdRgGooQjPjua");

pub mod errors;
pub mod instructions;
pub mod state;

use crate::instructions::*;

#[program]
pub mod fee_distributor {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>, args: InitializeVaultArgs) -> Result<()> {
        initialize_vault::handler(ctx, args)
    }

    pub fn create_account(ctx: Context<CreateAccount>) -> Result<()> {
        create_account::handler(ctx)
    }

    pub fn update_claim(ctx: Context<UpdateClaim>, args: UpdateClaimArgs) -> Result<()> {
        update_claim::handler(ctx, args)
    }
}
