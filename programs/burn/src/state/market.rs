use crate::constants::{
    DECIMALS, FREE_TRANSFER_THRESHOLD, MARKET_SEED, MARKET_VAULT_SEED, SYMBOL_BURN, SYMBOL_MAX_LEN, SYMBOL_MIN_LEN,
};
use crate::math::swap_math;
use crate::state::*;
use crate::{constants::MAX_TOKEN_SUPPLY, errors::Error};
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::{prelude::*, system_program};
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};
use spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi;

#[account]
pub struct Market {
    pub config: Pubkey,     // 32
    pub token_mint: Pubkey, // 32
    /// The vault that holds the token.
    pub token_vault: Pubkey, // 32
    /// The vault that holds the native token(SOL).
    pub native_vault: Pubkey, // 32
    pub remaining_supply: u64, // 8
    pub symbol: String,     // 4 + 10
    pub bump: [u8; 1],      // 1
    pub native_vault_bump: [u8; 1], // 1
    pub transfer_hook_enabled: bool, // 1
    /// Whether the market is allowed to transfer tokens.
    pub free_transfer_allowed: bool, // 1
}

pub struct BuyTokenArgs<'b, 'c, 'info> {
    pub buy_amount: u64,
    pub max_pay: u64,
    pub config: &'b Account<'info, Config>,
    pub market: AccountInfo<'info>,
    pub native_vault: &'b UncheckedAccount<'info>,
    pub fee_recipient: &'b UncheckedAccount<'info>,
    pub token_vault: &'b InterfaceAccount<'info, TokenAccount>,
    pub token_recipient: &'b InterfaceAccount<'info, TokenAccount>,
    pub token_mint: &'b InterfaceAccount<'info, Mint>,
    pub payer: &'b Signer<'info>,
    pub token_program: &'b Interface<'info, TokenInterface>,
    pub system_program: &'b Program<'info, System>,

    pub extra_account_meta_list: Option<&'c AccountInfo<'info>>,
    pub hooks_program: Option<&'c AccountInfo<'info>>,
    pub burn_program: Option<AccountInfo<'info>>,
}

pub struct BuyTokenExactInArgs<'b, 'c, 'info> {
    pub pay_amount: u64,
    pub min_receive: u64,
    pub config: &'b Account<'info, Config>,
    pub market: AccountInfo<'info>,
    pub native_vault: &'b UncheckedAccount<'info>,
    pub fee_recipient: &'b UncheckedAccount<'info>,
    pub token_vault: &'b InterfaceAccount<'info, TokenAccount>,
    pub token_recipient: &'b InterfaceAccount<'info, TokenAccount>,
    pub token_mint: &'b InterfaceAccount<'info, Mint>,
    pub payer: &'b Signer<'info>,
    pub token_program: &'b Interface<'info, TokenInterface>,
    pub system_program: &'b Program<'info, System>,

    pub extra_account_meta_list: Option<&'c AccountInfo<'info>>,
    pub hooks_program: Option<&'c AccountInfo<'info>>,
    pub burn_program: Option<AccountInfo<'info>>,
}

pub struct SellTokenArgs<'b, 'c, 'info> {
    pub sell_amount: u64,
    pub min_receive: u64,
    pub config: &'b Account<'info, Config>,
    pub market: AccountInfo<'info>,
    pub native_vault: &'b UncheckedAccount<'info>,
    pub fee_recipient: &'b UncheckedAccount<'info>,
    pub token_vault: &'b InterfaceAccount<'info, TokenAccount>,
    pub token_mint: &'b InterfaceAccount<'info, Mint>,
    pub native_recipient: &'b UncheckedAccount<'info>,
    pub token_payer: &'b InterfaceAccount<'info, TokenAccount>,
    pub payer: &'b Signer<'info>,
    pub token_program: &'b Interface<'info, TokenInterface>,
    pub system_program: &'b Program<'info, System>,

    pub extra_account_meta_list: Option<&'c AccountInfo<'info>>,
    pub hooks_program: Option<&'c AccountInfo<'info>>,
    pub burn_program: Option<AccountInfo<'info>>,
}

impl Market {
    pub const LEN: usize = 8 + 32 * 4 + 8 + (4 + 10) + 1 * 4;

    pub fn seeds(&self) -> [&[u8]; 4] {
        [
            MARKET_SEED.as_bytes(),
            self.symbol.as_bytes(),
            self.config.as_ref(),
            self.bump.as_ref(),
        ]
    }

    pub fn native_vault_seeds(&self) -> [&[u8]; 4] {
        [
            MARKET_VAULT_SEED.as_bytes(),
            self.symbol.as_bytes(),
            self.config.as_ref(),
            self.native_vault_bump.as_ref(),
        ]
    }

    pub fn initialize<'info>(
        &mut self,
        config: &Account<'info, Config>,
        token_mint: &InterfaceAccount<'info, Mint>,
        token_vault: &InterfaceAccount<'info, TokenAccount>,
        symbol: String,
        bump: u8,
        transfer_hook_enabled: bool,
    ) {
        self.config = config.to_account_info().key();
        self.token_mint = token_mint.to_account_info().key();
        self.token_vault = token_vault.to_account_info().key();
        self.remaining_supply = MAX_TOKEN_SUPPLY;
        self.symbol = symbol;
        self.bump = [bump; 1];
        self.transfer_hook_enabled = transfer_hook_enabled;
        self.free_transfer_allowed = !transfer_hook_enabled;
    }

    pub fn create_native_vault<'info>(
        &mut self,
        payer: &Signer<'info>,
        native_vault: &UncheckedAccount<'info>,
        program_id: &Pubkey,
        system_program: &Program<'info, System>,
        rent: &Sysvar<'info, Rent>,
    ) -> Result<()> {
        let (native_vault_actual, native_vault_bump) = Pubkey::find_program_address(
            &[
                MARKET_VAULT_SEED.as_bytes(),
                self.symbol.as_bytes(),
                self.config.as_ref(),
            ],
            program_id,
        );
        require!(
            native_vault_actual.as_ref() == native_vault.key().as_ref(),
            Error::NativeVaultAccountMismatch
        );

        self.native_vault = native_vault_actual;
        self.native_vault_bump = [native_vault_bump; 1];

        system_program::create_account(
            CpiContext::new(
                system_program.to_account_info(),
                system_program::CreateAccount {
                    from: payer.to_account_info(),
                    to: native_vault.to_account_info(),
                },
            )
            .with_signer(&[&self.native_vault_seeds()]),
            rent.minimum_balance(0), // rent-free
            0,
            &system_program.key(),
        )
    }

    pub fn mint_total_supply_to_market_vault<'info>(
        &self,
        market: &Account<'info, Market>,
        token_mint: &InterfaceAccount<'info, Mint>,
        token_vault: &InterfaceAccount<'info, TokenAccount>,
        token_program: &Interface<'info, TokenInterface>,
    ) -> Result<()> {
        token_interface::mint_to(
            CpiContext::new(
                token_program.to_account_info(),
                token_interface::MintTo {
                    mint: token_mint.to_account_info(),
                    to: token_vault.to_account_info(),
                    authority: market.to_account_info(),
                },
            )
            .with_signer(&[&self.seeds()]),
            self.remaining_supply,
        )
    }

    pub fn buy_token<'b, 'c, 'info>(&mut self, args: BuyTokenArgs<'b, 'c, 'info>) -> Result<()> {
        require!(args.buy_amount > 0, Error::AmountCannotBeZero);
        let remaining_supply = self.remaining_supply;
        require!(args.buy_amount < remaining_supply, Error::BuyAmountTooLarge);
        self.remaining_supply -= args.buy_amount;
        self.change_free_transfer_allowed();

        let native_pay_amount = swap_math::compute_swap(args.buy_amount, remaining_supply, true)?;
        let fee = swap_math::compute_fee(native_pay_amount);

        require!(
            native_pay_amount as u128 + fee as u128 <= args.max_pay as u128,
            Error::PayAmountExceedsMaxPay
        );

        system_program::transfer(
            CpiContext::new(
                args.system_program.to_account_info(),
                system_program::Transfer {
                    from: args.payer.to_account_info(),
                    to: args.native_vault.to_account_info(),
                },
            ),
            native_pay_amount,
        )?;

        system_program::transfer(
            CpiContext::new(
                args.system_program.to_account_info(),
                system_program::Transfer {
                    from: args.payer.to_account_info(),
                    to: args.fee_recipient.to_account_info(),
                },
            ),
            fee,
        )?;

        self.transfer_token_to_recipient(
            args.buy_amount,
            args.config,
            args.market,
            args.token_vault,
            args.token_recipient,
            args.token_mint,
            args.token_program,
            args.extra_account_meta_list,
            args.hooks_program,
            args.burn_program,
        )?;

        msg!(
            "buy_amount:{},pay_amount:{},fee:{},remaining_supply:{}",
            args.buy_amount,
            native_pay_amount,
            fee,
            self.remaining_supply,
        );
        Ok(())
    }

    pub fn buy_token_exact_in<'b, 'c, 'info>(&mut self, args: BuyTokenExactInArgs<'b, 'c, 'info>) -> Result<()> {
        require!(args.pay_amount > 0, Error::AmountCannotBeZero);

        // transfer native token to ensure the payer has enough balance
        system_program::transfer(
            CpiContext::new(
                args.system_program.to_account_info(),
                system_program::Transfer {
                    from: args.payer.to_account_info(),
                    to: args.native_vault.to_account_info(),
                },
            ),
            args.pay_amount,
        )?;

        let buy_amount = swap_math::compute_buy_token_exact_in(args.pay_amount, self.remaining_supply)?;
        require!(buy_amount >= args.min_receive, Error::ReceiveAmountTooSmall);
        self.remaining_supply -= buy_amount;
        self.change_free_transfer_allowed();

        let fee = swap_math::compute_fee(args.pay_amount);
        system_program::transfer(
            CpiContext::new(
                args.system_program.to_account_info(),
                system_program::Transfer {
                    from: args.payer.to_account_info(),
                    to: args.fee_recipient.to_account_info(),
                },
            ),
            fee,
        )?;

        self.transfer_token_to_recipient(
            buy_amount,
            args.config,
            args.market,
            args.token_vault,
            args.token_recipient,
            args.token_mint,
            args.token_program,
            args.extra_account_meta_list,
            args.hooks_program,
            args.burn_program,
        )?;

        msg!(
            "buy_amount:{},pay_amount:{},fee:{},remaining_supply:{}",
            buy_amount,
            args.pay_amount,
            fee,
            self.remaining_supply
        );
        Ok(())
    }

    pub fn sell_token<'b, 'c, 'info>(&mut self, args: SellTokenArgs<'b, 'c, 'info>) -> Result<()> {
        require!(args.sell_amount > 0, Error::AmountCannotBeZero);
        // transfer token to vault
        // If the transfer is successful here, it means args.sell_amount <= (MAX_TOKEN_SUPPLY - remaining_supply).
        self.transfer_token_to_vault(&args)?;

        let remaining_supply = self.remaining_supply;
        self.remaining_supply += args.sell_amount;

        let native_receive_amount = swap_math::compute_swap(args.sell_amount, remaining_supply, false)?;
        let fee = swap_math::compute_fee(native_receive_amount);
        let native_receive_amount = native_receive_amount - fee;
        require!(native_receive_amount >= args.min_receive, Error::ReceiveAmountTooSmall);

        let seeds = self.native_vault_seeds();
        // transfer native token from market
        system_program::transfer(
            CpiContext::new(
                args.system_program.to_account_info(),
                system_program::Transfer {
                    from: args.native_vault.to_account_info(),
                    to: args.native_recipient.to_account_info(),
                },
            )
            .with_signer(&[&seeds]),
            native_receive_amount,
        )?;
        system_program::transfer(
            CpiContext::new(
                args.system_program.to_account_info(),
                system_program::Transfer {
                    from: args.native_vault.to_account_info(),
                    to: args.fee_recipient.to_account_info(),
                },
            )
            .with_signer(&[&seeds]),
            fee,
        )?;

        msg!(
            "sell_amount:{},receive_amount:{},fee:{},remaining_supply:{}",
            args.sell_amount,
            native_receive_amount,
            fee,
            self.remaining_supply
        );
        Ok(())
    }

    pub fn revoke_mint_authority<'info>(
        &self,
        market: AccountInfo<'info>,
        token_mint: &InterfaceAccount<'info, Mint>,
        token_program: &Interface<'info, TokenInterface>,
    ) -> Result<()> {
        token_interface::set_authority(
            CpiContext::new(
                token_program.to_account_info(),
                token_interface::SetAuthority {
                    account_or_mint: token_mint.to_account_info(),
                    current_authority: market.to_account_info(),
                },
            )
            .with_signer(&[&self.seeds()]),
            spl_token_2022::instruction::AuthorityType::MintTokens,
            None,
        )
    }

    pub fn check_symbol(symbol: &str) -> Result<()> {
        if (SYMBOL_MIN_LEN..=SYMBOL_MAX_LEN).contains(&symbol.len()) {
            if symbol.chars().all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit()) {
                Ok(())
            } else {
                err!(Error::InvalidSymbol)
            }
        } else {
            err!(Error::InvalidSymbolLength)
        }
    }

    pub fn change_free_transfer_allowed_for_burn<'info>(
        &mut self,
        black_hole: &InterfaceAccount<'info, TokenAccount>,
        native_vault: &UncheckedAccount<'info>,
        rent: &Sysvar<'info, Rent>,
    ) -> Result<u64> {
        let already_sold = MAX_TOKEN_SUPPLY - self.remaining_supply;
        // The number of native tokens that can be received when all the tokens held by the user are sold
        let mut at_least_native_tokens =
            swap_math::compute_swap(already_sold - black_hole.amount, self.remaining_supply, false)? as u128;
        at_least_native_tokens += rent.minimum_balance(native_vault.data_len()) as u128; // should add rent-free tokens

        let available_native_tokens = if (native_vault.lamports() as u128) < at_least_native_tokens {
            0
        } else {
            native_vault.lamports() - at_least_native_tokens as u64
        };

        if self.free_transfer_allowed == false {
            // When the remaining token is less than or equal to the threshold
            // and the available native token is less than 0.1 SOL, free transfer is allowed
            self.free_transfer_allowed =
                self.remaining_supply <= FREE_TRANSFER_THRESHOLD && available_native_tokens < 100_000_000 as u64;
        }

        msg!(
            "available_native_tokens:{},free_transfer_allowed:{}",
            available_native_tokens,
            self.free_transfer_allowed
        );

        Ok(available_native_tokens)
    }

    /// Change the `free_transfer_allowed` field based on the remaining supply.
    ///
    /// should be called after `Market` is updated
    pub fn change_free_transfer_allowed(&mut self) {
        if self.free_transfer_allowed {
            return; // already allowed
        }
        if self.symbol == SYMBOL_BURN {
            return; // cannot be changed for buy or sell instruction
        }
        self.free_transfer_allowed = self.remaining_supply <= FREE_TRANSFER_THRESHOLD;
    }

    pub fn transfer_token_to_recipient<'b, 'c, 'info>(
        &self,
        buy_amount: u64,
        config: &'b Account<'info, Config>,
        market: AccountInfo<'info>,
        token_vault: &'b InterfaceAccount<'info, TokenAccount>,
        token_recipient: &'b InterfaceAccount<'info, TokenAccount>,
        token_mint: &'b InterfaceAccount<'info, Mint>,
        token_program: &'b Interface<'info, TokenInterface>,

        extra_account_meta_list: Option<&'c AccountInfo<'info>>,
        hooks_program: Option<&'c AccountInfo<'info>>,
        burn_program: Option<AccountInfo<'info>>,
    ) -> Result<()> {
        if buy_amount == 0 {
            return Ok(());
        }

        let mut ix = spl_token_2022::instruction::transfer_checked(
            &token_program.key(),
            &token_vault.key(),
            &token_mint.key(),
            &token_recipient.key(),
            &market.key(),
            &[],
            buy_amount,
            DECIMALS,
        )?;

        let mut cpi_account_infos: Vec<AccountInfo<'info>> = vec![
            token_vault.to_account_info(),
            token_mint.to_account_info(),
            token_recipient.to_account_info(),
            market.to_account_info(),
        ];

        if extra_account_meta_list.is_some() {
            add_extra_accounts_for_execute_cpi(
                &mut ix,
                &mut cpi_account_infos,
                &hooks_program.unwrap().to_account_info().key(),
                token_vault.to_account_info(),
                token_mint.to_account_info(),
                token_recipient.to_account_info(),
                market.as_ref().to_account_info(),
                buy_amount,
                &[
                    extra_account_meta_list.unwrap().to_account_info(),
                    hooks_program.unwrap().to_account_info(),
                    config.to_account_info(),
                    burn_program.unwrap().to_account_info(),
                    market.to_account_info(),
                ],
            )?;
        }

        invoke_signed(&ix, &cpi_account_infos, &[&self.seeds()])?;
        Ok(())
    }

    fn transfer_token_to_vault<'b, 'c, 'info>(&self, args: &SellTokenArgs<'b, 'c, 'info>) -> Result<()> {
        let mut ix = spl_token_2022::instruction::transfer_checked(
            &args.token_program.key(),
            &args.token_payer.key(),
            &args.token_mint.key(),
            &args.token_vault.key(),
            &args.payer.key(),
            &[],
            args.sell_amount,
            DECIMALS,
        )?;

        let mut cpi_account_infos: Vec<AccountInfo<'info>> = vec![
            args.token_payer.to_account_info(),
            args.token_mint.to_account_info(),
            args.token_vault.to_account_info(),
            args.payer.to_account_info(),
        ];

        if args.extra_account_meta_list.is_some() {
            add_extra_accounts_for_execute_cpi(
                &mut ix,
                &mut cpi_account_infos,
                &args.hooks_program.unwrap().to_account_info().key(),
                args.token_payer.to_account_info(),
                args.token_mint.to_account_info(),
                args.token_vault.to_account_info(),
                args.payer.as_ref().to_account_info(),
                args.sell_amount,
                &[
                    args.extra_account_meta_list.unwrap().to_account_info(),
                    args.hooks_program.unwrap().to_account_info(),
                    args.config.to_account_info(),
                    args.burn_program.as_ref().unwrap().to_account_info(),
                    args.market.to_account_info(),
                ],
            )?;
        }

        invoke(&ix, &cpi_account_infos)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_symbol_valid() {
        let symbol = "ABC123";
        assert!(Market::check_symbol(symbol).is_ok());
    }

    #[test]
    fn test_check_symbol_too_short() {
        let symbol = "A";
        assert_eq!(Market::check_symbol(symbol), Err(Error::InvalidSymbolLength.into()));

        let symbol = " ";
        assert_eq!(Market::check_symbol(symbol), Err(Error::InvalidSymbolLength.into()));
    }

    #[test]
    fn test_check_symbol_too_long() {
        let symbol = "12345678901";
        assert_eq!(Market::check_symbol(symbol), Err(Error::InvalidSymbolLength.into()));
    }

    #[test]
    fn test_check_symbol_invalid_characters() {
        for symbol in ["abc123", "ABC-123", "ABC 123", "مرحبا", "здр", "こんに", "안녕", "  "] {
            assert_eq!(Market::check_symbol(symbol), Err(Error::InvalidSymbol.into()));
        }
    }

    #[test]
    fn test_next_free_transfer_allowed_when_transfer_hook_enabled_is_false() {
        let mut m = setup_market(false);
        m.change_free_transfer_allowed();
        assert_eq!(m.free_transfer_allowed, true);
    }

    #[test]
    fn test_next_free_transfer_allowed_when_transfer_hook_enabled_is_true_and_remaining_supply_is_gte_threshold() {
        let mut m = setup_market(true);
        m.change_free_transfer_allowed();
        assert_eq!(m.free_transfer_allowed, false);
    }

    #[test]
    fn test_next_free_transfer_allowed_when_transfer_hook_enabled_is_true_and_remaining_supply_is_eq_threshold() {
        let mut m = setup_market(true);
        m.remaining_supply = FREE_TRANSFER_THRESHOLD;
        m.change_free_transfer_allowed();
        assert_eq!(m.free_transfer_allowed, true);
    }

    #[test]
    fn test_next_free_transfer_allowed_when_transfer_hook_enabled_is_true_and_remaining_supply_is_lt_threshold() {
        let mut m = setup_market(true);
        m.remaining_supply = FREE_TRANSFER_THRESHOLD - 1;
        m.change_free_transfer_allowed();
        assert_eq!(m.free_transfer_allowed, true);
    }

    #[test]
    fn test_next_free_transfer_allowed_when_transfer_hook_enabled_is_true_and_remaining_supply_is_gte_threshold_and_symbol_is_burn(
    ) {
        let mut m = setup_market(true);
        m.symbol = SYMBOL_BURN.to_string();
        m.change_free_transfer_allowed();
        assert_eq!(m.free_transfer_allowed, false);
    }

    #[test]
    fn test_next_free_transfer_allowed_when_transfer_hook_enabled_is_true_and_remaining_supply_is_eq_threshold_and_symbol_is_burn(
    ) {
        let mut m = setup_market(true);
        m.symbol = SYMBOL_BURN.to_string();
        m.remaining_supply = FREE_TRANSFER_THRESHOLD;
        m.change_free_transfer_allowed();
        assert_eq!(m.free_transfer_allowed, false);
    }

    #[test]
    fn test_next_free_transfer_allowed_when_transfer_hook_enabled_is_true_and_remaining_supply_is_lt_threshold_and_symbol_is_burn(
    ) {
        let mut m = setup_market(true);
        m.symbol = SYMBOL_BURN.to_string();
        m.remaining_supply = FREE_TRANSFER_THRESHOLD - 1;
        m.change_free_transfer_allowed();
        assert_eq!(m.free_transfer_allowed, false);
    }

    fn setup_market(transfer_hook_enabled: bool) -> Market {
        Market {
            config: Pubkey::new_unique(),
            token_mint: Pubkey::new_unique(),
            token_vault: Pubkey::new_unique(),
            native_vault: Pubkey::new_unique(),
            remaining_supply: MAX_TOKEN_SUPPLY,
            symbol: "ABC123".to_string(),
            bump: [0],
            native_vault_bump: [0],
            transfer_hook_enabled,
            free_transfer_allowed: transfer_hook_enabled == false,
        }
    }
}
