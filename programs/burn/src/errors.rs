use anchor_lang::prelude::*;

#[error_code]
pub enum Error {
    #[msg("Not config authority")]
    NotConfigAuthority,
    #[msg("Amount cannot be zero")]
    AmountCannotBeZero,
    #[msg("Config account mismatch")]
    ConfigAccountMismatch,
    #[msg("Token mint account mismatch")]
    TokenMintAccountMismatch,
    #[msg("Owner must be black hole")]
    MustBlackHoleOwner,
    #[msg("Fee recipient mismatch")]
    FeeRecipientMismatch,
    #[msg("Buy amount too large")]
    BuyAmountTooLarge,
    #[msg("Pay amount exceeds max pay")]
    PayAmountExceedsMaxPay,
    #[msg("Invalid symbol length")]
    InvalidSymbolLength,
    #[msg("Invalid symbol")]
    InvalidSymbol,
    #[msg("Token vault account mismatch")]
    TokenVaultAccountMismatch,
    #[msg("Too much native token required")]
    TooMuchNativeTokenRequired,
    #[msg("Native vault account mismatch")]
    NativeVaultAccountMismatch,
    #[msg("Receive amount too small")]
    ReceiveAmountTooSmall,
    #[msg("Cannot use this instruction")]
    CannotUseThisInstruction,
    #[msg("Buy nonce unexpected")]
    NonceUnexpected,
    #[msg("Buy amount unexpected")]
    BuyAmountUnexpected,
    #[msg("Buy burn authority mismatch")]
    BuyBurnAuthorityMismatch,
    #[msg("ExtraAccountMetaList account is missing")]
    ExtraAccountMetaListAccountIsMissing,
    #[msg("Hooks program is missing")]
    HooksProgramIsMissing,
    #[msg("Hooks program is incorrect")]
    HooksProgramIsIncorrect,
    #[msg("Burn program is missing")]
    BurnProgramIsMissing,
    #[msg("Burn program is incorrect")]
    BurnProgramIsIncorrect,
}
