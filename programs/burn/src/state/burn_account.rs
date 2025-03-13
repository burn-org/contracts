use crate::errors::Error;
use anchor_lang::prelude::*;

#[account]
pub struct BurnAccount {
    pub nonce: u32,      // 4, Nonce of the buy.
    pub buy_amount: u64, // 8, Amount of the buy.
}

impl BurnAccount {
    pub const LEN: usize = 8 + 4 + 8;

    pub fn update_buy_amount(&mut self, next_nonce: u32, next_buy_amount: u64) -> Result<u64> {
        require!(self.nonce + 1 == next_nonce, Error::NonceUnexpected);
        require!(self.buy_amount < next_buy_amount, Error::BuyAmountUnexpected);

        let delta = next_buy_amount - self.buy_amount;
        self.nonce = next_nonce;
        self.buy_amount = next_buy_amount;
        msg!("delta:{}", delta);
        Ok(delta)
    }
}
