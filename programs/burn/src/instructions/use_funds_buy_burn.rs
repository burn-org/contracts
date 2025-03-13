use crate::math::swap_math;
use crate::program::Burn;
use crate::state::*;
use crate::{constants::*, errors::Error};
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct UseFundsBuyBurn<'info> {
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
        constraint = token_recipient.mint == market.token_mint.key() @ Error::TokenMintAccountMismatch,
        constraint = token_recipient.owner == BLACK_HOLE @ Error::MustBlackHoleOwner,
    )]
    pub token_recipient: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub buy_burn_authority: Signer<'info>,
    #[account(address = spl_token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    /// CHECK: ExtraAccountMetaList Account, MUST use these exact seeds
    pub extra_account_meta_list: AccountInfo<'info>,
    #[account(address = HOOKS_PROGRAM_ID)]
    /// CHECK:
    pub hooks_program: AccountInfo<'info>,
    pub burn_program: Program<'info, Burn>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UseFundsBuyBurnArgs {
    pub max_buy_amount: u64,
}

pub fn handler(ctx: Context<UseFundsBuyBurn>, args: UseFundsBuyBurnArgs) -> Result<()> {
    require!(args.max_buy_amount > 0, Error::AmountCannotBeZero);

    let accounts = ctx.accounts;
    let available_native_tokens = accounts.market.change_free_transfer_allowed_for_burn(
        &accounts.token_recipient,
        &accounts.native_vault,
        &accounts.rent,
    )?;
    // -1 to avoid selling the last token
    let mut buy_amount = (accounts.market.remaining_supply - 1).min(args.max_buy_amount);
    if available_native_tokens == 0 || buy_amount == 0 {
        return Ok(());
    }

    let mut pay_amount = swap_math::compute_swap(buy_amount, accounts.market.remaining_supply, true)?;
    let mut fee = swap_math::compute_fee(pay_amount);

    if (pay_amount as u128 + fee as u128) > (available_native_tokens as u128) {
        // buy token exact in
        (pay_amount, fee) = swap_math::split_pay_amount(available_native_tokens)?;
        buy_amount = swap_math::compute_buy_token_exact_in(pay_amount, accounts.market.remaining_supply)?;
        if buy_amount == 0 {
            return Ok(());
        }
    }

    accounts.market.remaining_supply -= buy_amount;
    // transfer fee to recipient
    system_program::transfer(
        CpiContext::new(
            accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: accounts.native_vault.to_account_info(),
                to: accounts.fee_recipient.to_account_info(),
            },
        )
        .with_signer(&[&accounts.market.native_vault_seeds()]),
        fee,
    )?;
    // transfer token to black hole
    let market_account_info = accounts.market.to_account_info().clone();
    accounts.market.transfer_token_to_recipient(
        buy_amount,
        &accounts.config,
        market_account_info,
        &accounts.token_vault,
        &accounts.token_recipient,
        &accounts.token_mint,
        &accounts.token_program,
        Some(&accounts.extra_account_meta_list),
        Some(&accounts.hooks_program),
        Some(accounts.burn_program.to_account_info()),
    )?;
    msg!(
        "buy_amount:{},pay_amount:{},fee:{},remaining_supply:{}",
        buy_amount,
        pay_amount,
        fee,
        accounts.market.remaining_supply,
    );

    Ok(())
}
