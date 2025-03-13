use crate::program::Burn;
use crate::state::*;
use crate::{constants::*, errors::Error};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct BuyBurnExactIn<'info> {
    #[account(
        has_one = buy_burn_authority @ Error::BuyBurnAuthorityMismatch,
        has_one = fee_recipient @ Error::FeeRecipientMismatch,
        seeds = [CONFIG.as_bytes()],
        bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut,
        seeds = [
            MARKET_SEED.as_bytes(),
            SYMBOL_BURN.as_bytes(),
            config.key().as_ref()
        ],
        bump,
        has_one = config @ Error::ConfigAccountMismatch,
        has_one = native_vault @ Error::NativeVaultAccountMismatch,
        has_one = token_mint @ Error::TokenMintAccountMismatch,
        has_one = token_vault @ Error::TokenVaultAccountMismatch,
    )]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: Already checked in the market.
    #[account(mut)]
    pub native_vault: UncheckedAccount<'info>,
    /// CHECK: Only used to receive fees.
    #[account(mut)]
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// If `market.free_transfer_allowed` is `false`, then `token_recipient.owner`
    /// MUST be `BLACK_HOLE`, otherwise no restrictions
    #[account(mut,
        constraint = token_recipient.mint == market.token_mint.key() @ Error::TokenMintAccountMismatch,
    )]
    pub token_recipient: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub buy_burn_authority: Signer<'info>,
    #[account(address = spl_token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

    /// CHECK: ExtraAccountMetaList Account, MUST use these exact seeds
    pub extra_account_meta_list: AccountInfo<'info>,
    #[account(address = HOOKS_PROGRAM_ID)]
    /// CHECK:
    pub hooks_program: AccountInfo<'info>,
    pub burn_program: Program<'info, Burn>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BuyBurnExactInArgs {
    /// The amount of the native token (SOL) to pay, not including fees.
    ///
    /// The actual amount paid will be `pay_amount + fees`.
    ///
    /// # Examples
    /// If you want to buy 1.234 SOL of token, you need to set pay_amount to 1.234 * 10^9,
    /// and the program will automatically add the trading fee on this basis.
    pub pay_amount: u64,
    /// The minimum amount of the token to receive.
    pub min_receive: u64,
}

pub fn handler(ctx: Context<BuyBurnExactIn>, args: BuyBurnExactInArgs) -> Result<()> {
    require!(args.pay_amount > 0, Error::AmountCannotBeZero);

    let accounts = ctx.accounts;
    require!(
        accounts.market.free_transfer_allowed || accounts.token_recipient.owner == BLACK_HOLE,
        Error::MustBlackHoleOwner
    );

    let market_account_info = accounts.market.to_account_info().clone();
    accounts.market.buy_token_exact_in(crate::state::BuyTokenExactInArgs {
        pay_amount: args.pay_amount,
        min_receive: args.min_receive,
        config: &accounts.config,
        market: market_account_info,
        native_vault: &accounts.native_vault,
        fee_recipient: &accounts.fee_recipient,
        token_vault: &accounts.token_vault,
        token_recipient: &accounts.token_recipient,
        token_mint: &accounts.token_mint,
        payer: &accounts.payer,
        token_program: &accounts.token_program,
        system_program: &accounts.system_program,

        extra_account_meta_list: Some(&accounts.extra_account_meta_list),
        hooks_program: Some(&accounts.hooks_program),
        burn_program: Some(accounts.burn_program.to_account_info()),
    })
}
