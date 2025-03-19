use crate::errors::Error;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use burn::{
    program::Burn,
    state::{Config, Market},
};

pub mod errors;

declare_id!("burnhzSCeNMFuTsQJRC8dc1EPffWAecnYk8CxxRuQzT");

#[program]
pub mod hooks {
    use anchor_lang::system_program;
    use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
    use spl_transfer_hook_interface::instruction::ExecuteInstruction;

    use super::*;

    pub fn initialize_account_meta_list(ctx: Context<InitializeAccountMetaList>, symbol: String) -> Result<()> {
        let account_metas = vec![
            // index 5, burn program
            ExtraAccountMeta::new_with_pubkey(&Burn::id(), false, false)?,
            // index 6, config account
            ExtraAccountMeta::new_external_pda_with_seeds(
                5,
                &[Seed::Literal {
                    bytes: b"config".to_vec(),
                }],
                false, // is_signer
                false, // is_writable
            )?,
            // index 7, market account
            ExtraAccountMeta::new_external_pda_with_seeds(
                5,
                &[
                    Seed::Literal {
                        bytes: b"market".to_vec(),
                    },
                    Seed::Literal {
                        bytes: symbol.as_bytes().to_vec(),
                    },
                    Seed::AccountKey {
                        index: 6, // config index
                    },
                ],
                false, // is_signer
                false, // is_writable
            )?,
        ];
        let account_size = ExtraAccountMetaList::size_of(account_metas.len())?;
        let lamports = ctx.accounts.rent.minimum_balance(account_size);

        let token_mint = ctx.accounts.token_mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"extra-account-metas",
            &token_mint.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ]];

        // Create the ExtraAccountMetaList account
        system_program::create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            account_size as u64,
            ctx.program_id,
        )?;

        // Initialize the ExtraAccountMetaList account with the extra accounts
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &account_metas,
        )?;
        Ok(())
    }

    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        utils::assert_is_transferring(&ctx.accounts.source_token)?;

        require!(
            utils::is_transfer_allowed(
                &ctx.accounts.market,
                Some(ctx.accounts.source_token.owner),
                Some(ctx.accounts.destination_token.owner)
            ),
            Error::TransferNotAllowed
        );

        Ok(())
    }

    pub fn is_transfer_allowed(
        ctx: Context<IsTransferAllowed>,
        source_token_owner: Option<Pubkey>,
        destination_token_owner: Option<Pubkey>,
    ) -> Result<bool> {
        Ok(utils::is_transfer_allowed(
            &ctx.accounts.market,
            source_token_owner,
            destination_token_owner,
        ))
    }
}

pub mod utils {
    use crate::errors::Error;
    use anchor_lang::prelude::*;
    use anchor_spl::{
        token_2022::spl_token_2022::{
            extension::{transfer_hook::TransferHookAccount, BaseStateWithExtensionsMut, PodStateWithExtensionsMut},
            pod::PodAccount,
        },
        token_interface::TokenAccount,
    };
    use burn::state::Market;

    const BLACK_HOLE: Pubkey = pubkey!("1nc1nerator11111111111111111111111111111111");

    pub fn is_transfer_allowed<'info>(
        market: &Account<'info, Market>,
        source_token_owner: Option<Pubkey>,
        destination_token_owner: Option<Pubkey>,
    ) -> bool {
        let mut allow_transfer = market.free_transfer_allowed;
        if let Some(source_token_owner) = source_token_owner {
            allow_transfer = allow_transfer || is_allowed_owner(&source_token_owner, &market.key());
        }
        if let Some(destination_token_owner) = destination_token_owner {
            allow_transfer = allow_transfer || is_allowed_owner(&destination_token_owner, &market.key());
        }
        if !allow_transfer && cfg!(feature = "allow-burn-transfer") {
            allow_transfer = market.symbol == "BURN";
        }
        allow_transfer
    }

    pub fn is_allowed_owner(owner: &Pubkey, market: &Pubkey) -> bool {
        owner.eq(market) || owner.eq(&BLACK_HOLE)
    }

    pub fn assert_is_transferring<'info>(source_token: &InterfaceAccount<'info, TokenAccount>) -> Result<()> {
        let source_token_info = source_token.to_account_info();
        let mut account_data_ref = source_token_info.try_borrow_mut_data()?;
        let mut account = PodStateWithExtensionsMut::<PodAccount>::unpack(*account_data_ref)?;
        let account_extension = account.get_extension_mut::<TransferHookAccount>()?;

        require!(
            bool::from(account_extension.transferring),
            Error::IsNotCurrentlyTransferring
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeAccountMetaList<'info> {
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: ExtraAccountMetaList Account, MUST use these exact seeds
    #[account(mut, seeds = [b"extra-account-metas", token_mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TransferHook<'info> {
    // index 0
    #[account(token::mint = token_mint, token::authority = owner)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    // index 1
    pub token_mint: InterfaceAccount<'info, Mint>,
    // index 2
    #[account(token::mint = token_mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source token account owner
    /// index 3
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList Account
    /// index 4
    pub extra_account_meta_list: UncheckedAccount<'info>,
    /// index 5
    pub burn_program: Program<'info, Burn>,
    /// index 6
    pub config: Account<'info, Config>,
    /// index 7
    #[account(
        has_one = token_mint,
        has_one = config
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct IsTransferAllowed<'info> {
    pub market: Account<'info, Market>,
}
