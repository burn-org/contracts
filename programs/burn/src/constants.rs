use anchor_lang::{prelude::Pubkey, pubkey};

pub const DECIMALS: u8 = 6;
pub const MAX_TOKEN_SUPPLY: u64 = (10e8 * 1e6) as u64;
pub const FREE_TRANSFER_THRESHOLD: u64 = MAX_TOKEN_SUPPLY * 1 / 100;
pub const CONFIG: &str = "config";
pub const MARKET_SEED: &str = "market";
pub const MARKET_VAULT_SEED: &str = "market_vault";
pub const SYMBOL_MIN_LEN: usize = 2;
pub const SYMBOL_MAX_LEN: usize = 10;
pub const SYMBOL_BURN: &str = "BURN";
pub const BURN_ACCOUNT_SEED: &str = "burn_account";
pub const HOOKS_PROGRAM_ID: Pubkey = pubkey!("burnhzSCeNMFuTsQJRC8dc1EPffWAecnYk8CxxRuQzT");
pub const BLACK_HOLE: Pubkey = pubkey!("1nc1nerator11111111111111111111111111111111");
