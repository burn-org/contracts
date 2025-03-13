use anchor_lang::prelude::*;

#[account]
pub struct Vault {
    pub authority: Pubkey, // 32
    pub bump: [u8; 1],     // 1
}

impl Vault {
    pub const LEN: usize = 8 + 32 + 1 + 31; // 31 bytes padding

    pub fn seeds(&self) -> [&[u8]; 2] {
        [b"vault", self.bump.as_ref()]
    }

    pub fn initialize(&mut self, authority: Pubkey, program_id: &Pubkey) {
        self.authority = authority;
        let (_pub_key, bump) = Pubkey::find_program_address(&[b"vault"], program_id);
        self.bump = [bump];
    }

    pub fn transfer<'info>(
        &self,
        vault: &Account<'info, Vault>,
        recipient: &UncheckedAccount<'info>,
        amount: u64,
    ) -> Result<()> {
        vault.sub_lamports(amount)?;
        recipient.add_lamports(amount)?;
        Ok(())
    }
}
