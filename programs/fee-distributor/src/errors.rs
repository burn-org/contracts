use anchor_lang::prelude::*;

#[error_code]
pub enum Error {
    /// code = 6000
    #[msg("Claim nonce unexpected")]
    NonceUnexpected,
    /// code = 6001
    #[msg("Claimed amount unexpected")]
    ClaimedAmountUnexpected,
    /// code = 6002
    #[msg("Missing authority")]
    MissingAuthority,
}
