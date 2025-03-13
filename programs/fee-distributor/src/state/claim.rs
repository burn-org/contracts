use crate::errors::Error;
use anchor_lang::prelude::*;

#[account]
pub struct Claim {
    pub nonce: u32,   // 4, Nonce of the claim.
    pub claimed: u64, // 8, Amount claimed.
}

impl Claim {
    pub const LEN: usize = 8 + 4 + 8 + 20; // 20 bytes padding.

    pub fn update_claim(&mut self, next_nonce: u32, next_claimed: u64) -> Result<u64> {
        require!(self.nonce + 1 == next_nonce, Error::NonceUnexpected);
        require!(self.claimed < next_claimed, Error::ClaimedAmountUnexpected);

        let delta = next_claimed - self.claimed;
        self.nonce = next_nonce;
        self.claimed = next_claimed;
        msg!("delta:{}", delta);
        Ok(delta)
    }
}
