use anchor_lang::prelude::*;

#[account]
pub struct Config {
    pub authority: Pubkey,          // 32
    pub fee_recipient: Pubkey,      // 32
    pub buy_burn_authority: Pubkey, // 32
}

impl Config {
    pub const LEN: usize = 8 + 32 * 3;

    pub fn initialize(&mut self, authority: Pubkey, fee_recipient: Pubkey, buy_burn_authority: Pubkey) {
        self.set_authority(authority);
        self.set_fee_recipient(fee_recipient);
        self.set_buy_burn_authority(buy_burn_authority);
    }

    pub fn set_authority(&mut self, authority: Pubkey) {
        self.authority = authority;
    }

    pub fn set_fee_recipient(&mut self, fee_recipient: Pubkey) {
        self.fee_recipient = fee_recipient;
    }

    pub fn set_buy_burn_authority(&mut self, buy_burn_authority: Pubkey) {
        self.buy_burn_authority = buy_burn_authority;
    }
}
