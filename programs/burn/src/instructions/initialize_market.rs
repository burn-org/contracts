use std::u64;

use crate::constants::{CONFIG, DECIMALS, HOOKS_PROGRAM_ID, MARKET_SEED};
use crate::state::*;
use anchor_lang::{prelude::*, system_program};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{
    token_metadata_initialize, Mint, TokenAccount, TokenInterface, TokenMetadataInitialize,
};
use spl_token_metadata_interface::state::TokenMetadata;
use spl_type_length_value::variable_len_pack::VariableLenPack;

#[derive(Accounts)]
#[instruction(args: InitializeMarketArgs)]
pub struct InitializeMarket<'info> {
    #[account(seeds = [CONFIG.as_bytes()], bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(init, payer = payer,
        mint::authority = market,
        mint::decimals = DECIMALS,
        extensions::metadata_pointer::authority = market,
        extensions::metadata_pointer::metadata_address = token_mint,
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    /// The vault that holds the token.
    #[account(init, payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = market,
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(init, payer = payer, space = Market::LEN,
        seeds = [
            MARKET_SEED.as_bytes(),
            args.symbol.as_bytes(),
            config.key().as_ref()
        ],
        bump
    )]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: Initialized by the handler.
    /// The vault that holds the native token(SOL).
    #[account(mut)]
    pub native_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(address = spl_token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(args: InitializeMarketArgs)]
pub struct InitializeTransferHookMarket<'info> {
    #[account(seeds = [CONFIG.as_bytes()], bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(init, payer = payer,
        mint::authority = market,
        mint::decimals = DECIMALS,
        extensions::metadata_pointer::authority = market,
        extensions::metadata_pointer::metadata_address = token_mint,
        extensions::transfer_hook::authority = market,
        extensions::transfer_hook::program_id = HOOKS_PROGRAM_ID,
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    /// The vault that holds the token.
    #[account(init, payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = market,
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(init, payer = payer, space = Market::LEN,
        seeds = [
            MARKET_SEED.as_bytes(),
            args.symbol.as_bytes(),
            config.key().as_ref()
        ],
        bump
    )]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: Initialized by the handler.
    /// The vault that holds the native token(SOL).
    #[account(mut)]
    pub native_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(address = spl_token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeMarketArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

pub fn handler_initialize_market<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, InitializeMarket<'info>>,
    args: InitializeMarketArgs,
) -> Result<()> {
    Market::check_symbol(&args.symbol)?;

    // Step 1: Initialize the market.
    ctx.accounts.market.initialize(
        &ctx.accounts.config,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        args.symbol.clone(),
        ctx.bumps.market,
        false,
    );
    // Step 2: Create the native vault.
    ctx.accounts.market.create_native_vault(
        &ctx.accounts.payer,
        &ctx.accounts.native_vault,
        &ctx.program_id,
        &ctx.accounts.system_program,
        &ctx.accounts.rent,
    )?;

    // Step 3: Initialize the token metadata.
    initialize_token_metadata(
        &ctx.accounts.market,
        &ctx.accounts.payer,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_program,
        &ctx.accounts.rent,
        &ctx.accounts.system_program,
        args.name,
        args.symbol,
        args.uri,
    )?;
    // Step 4: Mint the total supply to the market vault.
    ctx.accounts.market.mint_total_supply_to_market_vault(
        &ctx.accounts.market,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &ctx.accounts.token_program,
    )?;
    // Step 5: Revoke the mint authority.
    let market_account_info = ctx.accounts.market.to_account_info().clone();
    ctx.accounts.market.revoke_mint_authority(
        market_account_info,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_program,
    )?;

    Ok(())
}

pub fn handler_initialize_transfer_hook_market<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, InitializeTransferHookMarket<'info>>,
    args: InitializeMarketArgs,
) -> Result<()> {
    Market::check_symbol(&args.symbol)?;

    // Step 1: Initialize the market.
    ctx.accounts.market.initialize(
        &ctx.accounts.config,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        args.symbol.clone(),
        ctx.bumps.market,
        true,
    );
    // Step 2: Create the native vault.
    ctx.accounts.market.create_native_vault(
        &ctx.accounts.payer,
        &ctx.accounts.native_vault,
        &ctx.program_id,
        &ctx.accounts.system_program,
        &ctx.accounts.rent,
    )?;

    // Step 3: Initialize the token metadata.
    initialize_token_metadata(
        &ctx.accounts.market,
        &ctx.accounts.payer,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_program,
        &ctx.accounts.rent,
        &ctx.accounts.system_program,
        args.name,
        args.symbol,
        args.uri,
    )?;
    // Step 4: Mint the total supply to the market vault.
    ctx.accounts.market.mint_total_supply_to_market_vault(
        &ctx.accounts.market,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &ctx.accounts.token_program,
    )?;
    // Step 5: Revoke the mint authority.
    let market_account_info = ctx.accounts.market.to_account_info().clone();
    ctx.accounts.market.revoke_mint_authority(
        market_account_info,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_program,
    )?;

    Ok(())
}

fn initialize_token_metadata<'info>(
    market: &Account<'info, Market>,
    payer: &Signer<'info>,
    token_mint: &Box<InterfaceAccount<'info, Mint>>,
    token_program: &Interface<'info, TokenInterface>,
    rent: &Sysvar<'info, Rent>,
    system_program: &Program<'info, System>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    let token_metadata = TokenMetadata {
        name: name.clone(),
        symbol: symbol.clone(),
        uri: uri.clone(),
        ..Default::default()
    };

    // Add 4 extra bytes for size of MetadataExtension (2 bytes for type, 2 bytes for length)
    let data_len = 4 + token_metadata.get_packed_len()?;

    // Calculate lamports required for the additional metadata
    let lamports = rent.minimum_balance(data_len);
    system_program::transfer(
        CpiContext::new(
            system_program.to_account_info(),
            system_program::Transfer {
                from: payer.to_account_info(),
                to: token_mint.to_account_info(),
            },
        ),
        lamports,
    )?;

    // Initialize token metadata
    token_metadata_initialize(
        CpiContext::new(
            token_program.to_account_info(),
            TokenMetadataInitialize {
                token_program_id: token_program.to_account_info(),
                mint: token_mint.to_account_info(),
                metadata: token_mint.to_account_info(),
                mint_authority: market.to_account_info(),
                update_authority: market.to_account_info(),
            },
        )
        .with_signer(&[&market.seeds()]),
        name,
        symbol,
        uri,
    )
}
