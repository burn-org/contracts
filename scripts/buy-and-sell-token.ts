import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Burn } from "../target/types/burn";
import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import { Hooks } from "../target/types/hooks";

let httpProxy = process.env.http_proxy;
if (httpProxy) {
  const { ProxyAgent, setGlobalDispatcher } = require("undici");

  const proxyAgent = new ProxyAgent(httpProxy);
  setGlobalDispatcher(proxyAgent);

  console.log(
    `Detected http_proxy environment variable, set proxy to ${httpProxy}`
  );
}

// Configure the client to use the local cluster.
anchor.setProvider(anchor.AnchorProvider.env());

// Buy and sell token
async function buyAndSellToken(symbol: string) {
  const idl = require("../target/idl/burn.json");
  const program = new anchor.Program(idl) as Program<Burn>;
  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const hooksIdl = require("../target/idl/hooks.json");
  const hooksProgram = new anchor.Program(hooksIdl) as Program<Hooks>;

  const [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(symbol), configPda.toBuffer()],
    program.programId
  );
  console.log(`symbol: ${symbol}, market pda: ${marketPda.toBase58()}`);
  const { feeRecipient } = await program.account.config.fetch(configPda);
  const market = await program.account.market.fetch(marketPda);
  console.log(`Market: ${JSON.stringify(market, null, 4)}`);
  const wallet = anchor.Wallet.local();
  const tx = new anchor.web3.Transaction();
  const tokenRecipientAta = getAssociatedTokenAddressSync(
    market.tokenMint,
    wallet.publicKey,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  try {
    await getAccount(
      anchor.getProvider().connection,
      tokenRecipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  } catch (error: unknown) {
    if (
      error instanceof TokenAccountNotFoundError ||
      error instanceof TokenInvalidAccountOwnerError
    ) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          tokenRecipientAta,
          wallet.publicKey,
          market.tokenMint,
          TOKEN_2022_PROGRAM_ID
        )
      );
    } else {
      throw error;
    }
  }

  const [extraAccountMetaListPda] =
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), market.tokenMint.toBuffer()],
      hooksProgram.programId
    );

  // Buy token method 1: buy a fixed amount of tokens, pay an dynamic amount of SOL
  const buyIX = await program.methods
    .buyToken({
      buyAmount: new anchor.BN(100e6), // buy 100 tokens, all token decimals are 6
      maxPay: new anchor.BN(1e9), // max pay 1 SOL, decimals = 9. If the actual pay amount is more than 1 SOL, the transaction will fail
    })
    .accountsPartial({
      config: configPda,
      market: marketPda,
      feeRecipient: feeRecipient, // fixed value, get from config account
      tokenVault: market.tokenVault, // fixed value, get from market account
      tokenRecipient: tokenRecipientAta, // token recipient associated token account
      nativeVault: market.nativeVault, // fixed value, get from market account
      tokenMint: market.tokenMint, // fixed value, get from market account
      payer: wallet.publicKey, // payer to pay SOL
    })
    .remainingAccounts(
      market.transferHookEnabled // if transfer hook enabled, add extra account meta list account
        ? [
            {
              pubkey: extraAccountMetaListPda,
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: hooksProgram.programId,
              isSigner: false,
              isWritable: false,
            },
            { pubkey: program.programId, isSigner: false, isWritable: false },
          ]
        : []
    )
    .instruction();
  // Buy token method 2: pay a fixed amount of SOL, buy an dynamic amount of tokens
  const buyExactInIX = await program.methods
    .buyTokenExactIn({
      payAmount: new anchor.BN(1e8), // fixed pay 0.1 SOL, decimals = 9
      minReceive: new anchor.BN(100e6), // min receive 100 tokens, all token decimals are 6. If the actual receive amount is less than 100 tokens, the transaction will fail
    })
    .accountsPartial({
      config: configPda,
      market: marketPda,
      feeRecipient: feeRecipient, // fixed value, get from config account
      tokenVault: market.tokenVault, // fixed value, get from market account
      tokenRecipient: tokenRecipientAta, // token recipient associated token account
      nativeVault: market.nativeVault, // fixed value, get from market account
      tokenMint: market.tokenMint, // fixed value, get from market account
      payer: wallet.publicKey, // payer to pay SOL
    })
    .remainingAccounts(
      market.transferHookEnabled // if transfer hook enabled, add extra account meta list account
        ? [
            {
              pubkey: extraAccountMetaListPda,
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: hooksProgram.programId,
              isSigner: false,
              isWritable: false,
            },
            { pubkey: program.programId, isSigner: false, isWritable: false },
          ]
        : []
    )
    .instruction();
  // Sell token: sell a fixed amount of tokens, receive an dynamic amount of SOL
  const sellIX = await program.methods
    .sellToken({
      sellAmount: new anchor.BN(1000e6), // sell 1000 tokens, all token decimals are 6
      minReceive: new anchor.BN(10), // min receive 0.00000001 SOL, decimals = 9. If the actual receive amount is less than 0.00000001 SOL, the transaction will fail
    })
    .accountsPartial({
      config: configPda,
      market: marketPda,
      feeRecipient: feeRecipient, // fixed value, get from config account
      tokenVault: market.tokenVault, // fixed value, get from market account
      nativeRecipient: wallet.publicKey, // native recipient to receive SOL
      tokenPayer: tokenRecipientAta, // token payer associated token account
      nativeVault: market.nativeVault, // fixed value, get from market account
      tokenMint: market.tokenMint, // fixed value, get from market account
    })
    .remainingAccounts(
      market.transferHookEnabled // if transfer hook enabled, add extra account meta list account
        ? [
            {
              pubkey: extraAccountMetaListPda,
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: hooksProgram.programId,
              isSigner: false,
              isWritable: false,
            },
            { pubkey: program.programId, isSigner: false, isWritable: false },
          ]
        : []
    )
    .instruction();

  // add instructions to transaction
  // this is just an example, in real scene, you can choose to add one or more instructions
  tx.add(buyIX, buyExactInIX, sellIX);
  const sig = await anchor.getProvider().sendAndConfirm(tx, [wallet.payer]);
  console.log("Buy and sell token with signature", sig);
}

const args = process.argv.slice(2);
buyAndSellToken(args[0])
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
