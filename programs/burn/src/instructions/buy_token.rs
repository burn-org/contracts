use crate::constants::HOOKS_PROGRAM_ID;
use crate::state::*;
use crate::{constants::CONFIG, errors::Error};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct BuyToken<'info> {
    #[account(
        has_one = fee_recipient @ Error::FeeRecipientMismatch,
        seeds = [CONFIG.as_bytes()],
        bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut,
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
        constraint = token_recipient.mint == market.token_mint.key() @ Error::TokenMintAccountMismatch
    )]
    pub token_recipient: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(address = spl_token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BuyTokenArgs {
    pub buy_amount: u64,
    pub max_pay: u64,
}

pub fn handler<'a, 'b, 'c, 'info>(ctx: Context<'a, 'b, 'c, 'info, BuyToken<'info>>, args: BuyTokenArgs) -> Result<()> {
    use crate::constants;

    let accounts = ctx.accounts;
    if accounts.market.symbol == constants::SYMBOL_BURN {
        require!(accounts.market.free_transfer_allowed, Error::CannotUseThisInstruction);
    }

    let mut extra_account_meta_list: Option<&'c AccountInfo<'info>> = None;
    let mut hooks_program: Option<&'c AccountInfo<'info>> = None;
    let mut burn_program: Option<AccountInfo<'info>> = None;
    if accounts.market.transfer_hook_enabled {
        let mut iter = ctx.remaining_accounts.iter();
        extra_account_meta_list = Some(iter.next().ok_or(Error::ExtraAccountMetaListAccountIsMissing)?);
        hooks_program = Some(iter.next().ok_or(Error::HooksProgramIsMissing)?);
        require!(
            &hooks_program.unwrap().key() == &HOOKS_PROGRAM_ID,
            Error::HooksProgramIsIncorrect
        );
        burn_program = Some(iter.next().map(|a| a.clone()).ok_or(Error::BurnProgramIsMissing)?);
        require!(
            &burn_program.as_ref().unwrap().key() == ctx.program_id,
            Error::BurnProgramIsIncorrect
        );
    }

    let market_account_info = accounts.market.to_account_info().clone();
    accounts.market.buy_token(crate::state::BuyTokenArgs {
        buy_amount: args.buy_amount,
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

        extra_account_meta_list,
        hooks_program,
        burn_program,
    })
}
