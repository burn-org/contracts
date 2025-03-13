use crate::constants::HOOKS_PROGRAM_ID;
use crate::state::*;
use crate::{constants::CONFIG, errors::Error};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct SellToken<'info> {
    #[account(
        has_one = fee_recipient @ Error::FeeRecipientMismatch,
        seeds = [CONFIG.as_bytes()],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut,
        has_one = config @ Error::ConfigAccountMismatch,
        has_one = token_vault @ Error::TokenVaultAccountMismatch,
        has_one = native_vault @ Error::NativeVaultAccountMismatch,
        has_one = token_mint @ Error::TokenMintAccountMismatch,
    )]
    pub market: Account<'info, Market>,
    /// CHECK: Already checked in the market.
    #[account(mut)]
    pub native_vault: UncheckedAccount<'info>,
    /// CHECK: Only used to receive fees.
    #[account(mut)]
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: Only used to receive native tokens.
    #[account(mut)]
    pub native_recipient: UncheckedAccount<'info>,
    #[account(mut,
        token::mint = market.token_mint,
        token::authority = payer,
    )]
    pub token_payer: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub payer: Signer<'info>,
    #[account(address = spl_token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SellTokenArgs {
    pub sell_amount: u64,
    pub min_receive: u64,
}

pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, SellToken<'info>>,
    args: SellTokenArgs,
) -> Result<()> {
    let accounts = ctx.accounts;
    let market_account_info = accounts.market.to_account_info().clone();
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

    accounts.market.sell_token(crate::state::SellTokenArgs {
        sell_amount: args.sell_amount,
        config: &accounts.config,
        market: market_account_info,
        min_receive: args.min_receive,
        native_vault: &accounts.native_vault,
        fee_recipient: &accounts.fee_recipient,
        token_vault: &accounts.token_vault,
        native_recipient: &accounts.native_recipient,
        token_payer: &accounts.token_payer,
        token_mint: &accounts.token_mint,
        payer: &accounts.payer,
        token_program: &accounts.token_program,
        system_program: &accounts.system_program,

        extra_account_meta_list,
        hooks_program,
        burn_program,
    })
}
