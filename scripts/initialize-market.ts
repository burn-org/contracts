import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Burn } from "../target/types/burn";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Hooks } from "../target/types/hooks";
import { compute_swap_with_fee } from "../tests/math/swap_math";
import { MAX_TOKEN_SUPPLY } from "../tests/math/token_math";
import { input, select, password, confirm } from "@inquirer/prompts";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

let httpProxy = process.env.http_proxy;
if (httpProxy) {
  const { ProxyAgent, setGlobalDispatcher } = require("undici");

  const proxyAgent = new ProxyAgent(httpProxy);
  setGlobalDispatcher(proxyAgent);

  console.log(
    `Detected http_proxy environment variable, set proxy to ${httpProxy}`
  );
}

async function initializeMarket(
  name: string,
  symbol: string,
  uri: string,
  wallet: anchor.Wallet,
  transferHookEnabled: boolean = false,
  initializeBuyAmount: bigint = BigInt(0),
  tokenMintKeypair: anchor.web3.Keypair
) {
  if (tokenMintKeypair == undefined) {
    tokenMintKeypair = anchor.web3.Keypair.generate();
  }
  if (symbol == "BURN") {
    if (name != "Burn") {
      throw new Error("BURN token must have name 'Burn'");
    }
    if (transferHookEnabled == false) {
      throw new Error("BURN token must have transfer hook enabled");
    }
    if (initializeBuyAmount != BigInt(0)) {
      throw new Error("BURN token cannot have initial buy amount");
    }
    if (!tokenMintKeypair.publicKey.toBase58().startsWith("burn")) {
      throw new Error("BURN token mint must start with 'burn'");
    }
  }

  const idl = require("../target/idl/burn.json");
  const program = new anchor.Program(idl) as Program<Burn>;
  const hooksIdl = require("../target/idl/hooks.json");
  const hooksProgram = new anchor.Program(hooksIdl) as Program<Hooks>;

  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const { feeRecipient } = await program.account.config.fetch(configPda);
  const [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(symbol), configPda.toBuffer()],
    program.programId
  );
  const [nativeVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market_vault"), Buffer.from(symbol), configPda.toBuffer()],
    program.programId
  );
  const [extraAccountMetaListPda] =
    anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("extra-account-metas"),
        tokenMintKeypair.publicKey.toBuffer(),
      ],
      hooksProgram.programId
    );
  const tokenVaultAta = getAssociatedTokenAddressSync(
    tokenMintKeypair.publicKey,
    marketPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  const args = {
    name: name,
    symbol: symbol,
    uri: uri,
  };
  let initializeMarketIx: anchor.web3.TransactionInstruction;
  if (transferHookEnabled) {
    initializeMarketIx = await program.methods
      .initializeTransferHookMarket(args)
      .accountsPartial({
        config: configPda,
        tokenMint: tokenMintKeypair.publicKey,
        tokenVault: tokenVaultAta,
        market: marketPda,
        nativeVault: nativeVaultPda,
      })
      .instruction();
  } else {
    initializeMarketIx = await program.methods
      .initializeMarket(args)
      .accountsPartial({
        config: configPda,
        tokenMint: tokenMintKeypair.publicKey,
        tokenVault: tokenVaultAta,
        market: marketPda,
        nativeVault: nativeVaultPda,
      })
      .instruction();
  }
  const tx = new anchor.web3.Transaction();
  tx.add(initializeMarketIx);
  if (transferHookEnabled) {
    tx.add(
      await hooksProgram.methods
        .initializeAccountMetaList(symbol)
        .accountsPartial({
          tokenMint: tokenMintKeypair.publicKey,
          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction()
    );
  }
  if (initializeBuyAmount > BigInt(0)) {
    const tokenRecipientAta = getAssociatedTokenAddressSync(
      tokenMintKeypair.publicKey,
      wallet.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    tx.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipientAta,
        wallet.publicKey,
        tokenMintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
    const { total } = compute_swap_with_fee(
      initializeBuyAmount,
      MAX_TOKEN_SUPPLY,
      true
    );
    tx.add(
      await program.methods
        .buyToken({
          buyAmount: new anchor.BN(initializeBuyAmount.toString()),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipient,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipientAta,
          payer: wallet.publicKey,
          nativeVault: nativeVaultPda,
          tokenMint: tokenMintKeypair.publicKey,
        })
        .remainingAccounts(
          transferHookEnabled
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
                {
                  pubkey: program.programId,
                  isSigner: false,
                  isWritable: false,
                },
              ]
            : []
        )
        .instruction()
    );
  }

  // simulate before send
  const sigs = await anchor.getProvider().sendAll([
    {
      tx: tx,
      signers: [wallet.payer, tokenMintKeypair],
    },
  ]);
  console.log(`Transaction already send, signature: ${sigs[0]}`);
}

async function main() {
  let providerURL = process.env.ANCHOR_PROVIDER_URL;
  if (!providerURL) {
    providerURL = await input({
      message:
        "Please enter the provider URL, you can enter devnet or mainnet or a URL:",
      default: "devnet",
      required: true,
    });
    if (providerURL.toLowerCase() == "devnet") {
      providerURL = "https://api.devnet.solana.com";
    } else if (
      providerURL.toLowerCase() == "mainnet" ||
      providerURL.toLowerCase() == "mainnet-beta"
    ) {
      providerURL = "https://api.mainnet-beta.solana.com";
    }
  }

  let payerPrivateKey = process.env.ANCHOR_WALLET;
  if (!payerPrivateKey) {
    payerPrivateKey = await password({
      message:
        "Please enter the private key of the payer (empty means use local wallet):",
    });
  }
  if (payerPrivateKey.length == 0) {
    const path = require("path");
    const fs = require("fs");
    const homedir = require("os").homedir();
    payerPrivateKey = fs.readFileSync(
      path.join(homedir, ".config/solana/id.json"),
      "utf-8"
    );
  }
  const payerKeypair = parsePrivateKey(payerPrivateKey);

  const tokenName = await input({
    message: "Please enter the name of the token:",
    required: true,
  });
  const tokenSymbol = (
    await input({
      message: "Please enter the symbol of the token:",
      required: true,
    })
  ).toUpperCase();
  const tokenURI = await input({
    message: "Please enter the URI of the token:",
  });
  const transferHookEnabled =
    (await select({
      message: "Is the transfer hook enabled?",
      choices: ["Yes", "No"],
      default: "No",
    })) == "Yes";
  const initializeBuyAmount = BigInt(
    await input({
      message: "Please enter the initial buy amount:",
      default: "0",
    })
  );
  let tokenMintPrivateKey = await password({
    message:
      "Please enter the private key of the token mint (empty means use dynamic generate key):",
  });
  if (tokenMintPrivateKey.length == 0) {
    tokenMintPrivateKey = bs58.encode(anchor.web3.Keypair.generate().secretKey);
  }

  let tokenMint: anchor.web3.Keypair = parsePrivateKey(tokenMintPrivateKey);
  const yes = await confirm({
    message: `Please confirm:
Provider: ${providerURL}
Payer: ${payerKeypair.publicKey.toBase58()}
Token name: ${tokenName}
Token symbol: ${tokenSymbol}
Token URI: ${tokenURI}
Transfer hook enabled: ${transferHookEnabled}
Initial buy amount: ${initializeBuyAmount}.000000 ${tokenSymbol}
Token mint public key: ${tokenMint.publicKey.toBase58()}    
    `,
  });
  if (!yes) {
    return;
  }

  const wallet = new anchor.Wallet(payerKeypair);
  anchor.setProvider(
    new anchor.AnchorProvider(new anchor.web3.Connection(providerURL), wallet)
  );

  await initializeMarket(
    tokenName,
    tokenSymbol,
    tokenURI,
    wallet,
    transferHookEnabled,
    initializeBuyAmount * BigInt(1e6),
    tokenMint
  );
}

function parsePrivateKey(privateKey: string): anchor.web3.Keypair {
  if (privateKey.startsWith("[") && privateKey.endsWith("]")) {
    const strArr = privateKey.substring(1, privateKey.length - 1).split(",");
    const arr = [];
    for (let i = 0; i < strArr.length; i++) {
      arr.push(parseInt(strArr[i].trim()));
    }
    return anchor.web3.Keypair.fromSecretKey(new Uint8Array(arr));
  } else {
    return anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(bs58.decode(privateKey))
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
