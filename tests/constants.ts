import * as anchor from "@coral-xyz/anchor";

export const DECIMALS: number = 6;
export const MAX_TOKEN_SUPPLY = BigInt(10e8) * BigInt(1e6);
export const BLACK_HOLE = new anchor.web3.PublicKey(
  "1nc1nerator11111111111111111111111111111111"
);
