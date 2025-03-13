use crate::constants::*;
use crate::errors::Error;
use crate::program::Burn;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct BuyBurn<'info> {
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
    #[account(mut,
        seeds = [
            BURN_ACCOUNT_SEED.as_bytes(),
            payer.key().as_ref(),
            config.key().as_ref()
        ], bump)]
    pub burn_account: Account<'info, BurnAccount>,
    #[account(mut,
        constraint = token_recipient.mint == market.token_mint.key() @ Error::TokenMintAccountMismatch
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
pub struct BuyBurnArgs {
    pub next_nonce: u32,
    pub next_buy_amount: u64,
    pub max_pay: u64,
}

pub fn handler<'a, 'b, 'c, 'info>(ctx: Context<'a, 'b, 'c, 'info, BuyBurn<'info>>, args: BuyBurnArgs) -> Result<()> {
    let accounts = ctx.accounts;
    let buy_amount = accounts
        .burn_account
        .update_buy_amount(args.next_nonce, args.next_buy_amount)?;

    let market_account_info = accounts.market.to_account_info().clone();
    accounts.market.buy_token(crate::state::BuyTokenArgs {
        buy_amount,
        max_pay: args.max_pay,
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
