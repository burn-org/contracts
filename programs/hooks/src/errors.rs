use anchor_lang::prelude::*;

#[error_code]
pub enum Error {
    #[msg("Transfer not allowed")]
    TransferNotAllowed,
    #[msg("The token is not currently transferring")]
    IsNotCurrentlyTransferring,
}
