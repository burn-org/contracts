use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use crate::instructions::*;

declare_id!("burnpzY5Sy2j4ZyQmjdQbBFiJW9T99GxDykASG2QrMu");

#[program]
pub mod burn {
    use super::*;

    /// Initializes a new config account.
    pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
        initialize_config::handler(ctx, args)
    }

    /// Sets the authority of the config account.
    pub fn set_config_authority(
        ctx: Context<SetAuthority>,
        authority: Option<Pubkey>,
        buy_burn_authority: Option<Pubkey>,
    ) -> Result<()> {
        set_config_authority::handler(ctx, authority, buy_burn_authority)
    }

    /// Sets the fee recipient of the config account.
    pub fn set_fee_recipient(ctx: Context<SetFeeRecipient>, fee_recipient: Pubkey) -> Result<()> {
        set_fee_recipient::handler(ctx, fee_recipient)
    }

    /// Initializes a new market.
    pub fn initialize_market<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, InitializeMarket<'info>>,
        args: InitializeMarketArgs,
    ) -> Result<()> {
        initialize_market::handler_initialize_market(ctx, args)
    }

    pub fn initialize_transfer_hook_market<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, InitializeTransferHookMarket<'info>>,
        args: InitializeMarketArgs,
    ) -> Result<()> {
        initialize_market::handler_initialize_transfer_hook_market(ctx, args)
    }

    pub fn buy_token<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, BuyToken<'info>>,
        args: buy_token::BuyTokenArgs,
    ) -> Result<()> {
        buy_token::handler(ctx, args)
    }

    pub fn buy_token_exact_in<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, BuyTokenExactIn<'info>>,
        args: buy_token_exact_in::BuyTokenExactInArgs,
    ) -> Result<()> {
        buy_token_exact_in::handler(ctx, args)
    }

    pub fn sell_token<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, SellToken<'info>>,
        args: sell_token::SellTokenArgs,
    ) -> Result<()> {
        sell_token::handler(ctx, args)
    }

    pub fn create_burn_account(ctx: Context<CreateBurnAccount>) -> Result<()> {
        create_burn_account::handler(ctx)
    }

    pub fn buy_burn<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, BuyBurn<'info>>,
        args: buy_burn::BuyBurnArgs,
    ) -> Result<()> {
        buy_burn::handler(ctx, args)
    }

    pub fn buy_burn_exact_in<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, BuyBurnExactIn<'info>>,
        args: buy_burn_exact_in::BuyBurnExactInArgs,
    ) -> Result<()> {
        buy_burn_exact_in::handler(ctx, args)
    }

    pub fn use_funds_buy_burn<'info>(ctx: Context<UseFundsBuyBurn<'info>>, args: UseFundsBuyBurnArgs) -> Result<()> {
        use_funds_buy_burn::handler(ctx, args)
    }
}
