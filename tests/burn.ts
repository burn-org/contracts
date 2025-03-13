import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Burn } from "../target/types/burn";
import { BLACK_HOLE, DECIMALS, MAX_TOKEN_SUPPLY } from "./constants";
import { assert, expect } from "chai";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMetadataPointerState,
  getMint,
  getOrCreateAssociatedTokenAccount,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  compute_buy_token_exact_in_with_fee,
  compute_swap_with_fee,
} from "./math/swap_math";
import { Hooks } from "../target/types/hooks";

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe("burn", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Burn as Program<Burn>;
  const hooksProgram = anchor.workspace.Hooks as anchor.Program<Hooks>;
  const wallet = anchor.Wallet.local().payer;

  let config: {
    configPda: anchor.web3.PublicKey;
    authorityKeypair: anchor.web3.Keypair;
    feeRecipientKeypair: anchor.web3.Keypair;
    buyBurnAuthorityKeypair: anchor.web3.Keypair;
  } = null;
  let burn: {
    mintKeypair: anchor.web3.Keypair;
    marketPda: anchor.web3.PublicKey;
    tokenVaultAta: anchor.web3.PublicKey;
    nativeVaultPda: anchor.web3.PublicKey;
    extraAccountMetaListPda: anchor.web3.PublicKey;
  };
  let nextSymbolIndex = 0;

  before(async () => {
    config = await initializeConfig();
    burn = await initializeMarket(
      config.configPda,
      undefined,
      "BURN",
      undefined,
      true
    );
  });
  afterEach(async () => {
    const cfg = await program.account.config.fetch(config.configPda);
    expect(cfg.authority.toBase58()).to.be.eq(
      config.authorityKeypair.publicKey.toBase58()
    );
    expect(cfg.feeRecipient.toBase58()).to.be.eq(
      config.feeRecipientKeypair.publicKey.toBase58()
    );
    expect(cfg.buyBurnAuthority.toBase58()).to.be.eq(
      config.buyBurnAuthorityKeypair.publicKey.toBase58()
    );
  });

  describe("#set_config_authority", () => {
    it("should fail if not the authority", async () => {
      try {
        await program.methods
          .setConfigAuthority(wallet.publicKey, null)
          .accountsPartial({
            config: config.configPda,
            authority: wallet.publicKey,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq("NotConfigAuthority");
      }
    });

    it("should succeed", async () => {
      await program.methods
        .setConfigAuthority(wallet.publicKey, wallet.publicKey)
        .accountsPartial({
          config: config.configPda,
          authority: config.authorityKeypair.publicKey,
        })
        .signers([config.authorityKeypair])
        .rpc();

      const cfg = await program.account.config.fetch(config.configPda);
      expect(cfg.authority.toBase58()).to.be.eq(wallet.publicKey.toBase58());
      expect(cfg.buyBurnAuthority.toBase58()).to.be.eq(
        wallet.publicKey.toBase58()
      );

      // recover authority
      await program.methods
        .setConfigAuthority(
          config.authorityKeypair.publicKey,
          config.buyBurnAuthorityKeypair.publicKey
        )
        .accountsPartial({
          config: config.configPda,
          authority: wallet.publicKey,
        })
        .signers([wallet])
        .rpc();
    });
  });

  describe("#set_fee_recipient", () => {
    it("should fail if not the authority", async () => {
      try {
        await program.methods
          .setFeeRecipient(wallet.publicKey)
          .accountsPartial({
            config: config.configPda,
            authority: wallet.publicKey,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq("NotConfigAuthority");
      }
    });

    it("should succeed", async () => {
      await program.methods
        .setFeeRecipient(wallet.publicKey)
        .accountsPartial({
          config: config.configPda,
          authority: config.authorityKeypair.publicKey,
        })
        .signers([config.authorityKeypair])
        .rpc();

      const cfg = await program.account.config.fetch(config.configPda);
      expect(cfg.feeRecipient.toBase58()).to.be.eq(wallet.publicKey.toBase58());

      // recover fee recipient
      await program.methods
        .setFeeRecipient(config.feeRecipientKeypair.publicKey)
        .accountsPartial({
          config: config.configPda,
          authority: config.authorityKeypair.publicKey,
        })
        .signers([config.authorityKeypair])
        .rpc();
    });
  });

  describe("#initialize_market", () => {
    describe("should failed if symbol invalid", () => {
      [" ", "abc 123", "abc", "ABC ", "ABC 123"].forEach((symbol) => {
        it(`invalid symbol: ${symbol}`, async () => {
          const mintKeypair = anchor.web3.Keypair.generate();
          const [marketPda, marketBump] =
            anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("market"),
                Buffer.from(symbol),
                config.configPda.toBuffer(),
              ],
              program.programId
            );
          const [nativeVaultPda, nativeVaultBump] =
            anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("market_vault"),
                Buffer.from(symbol),
                config.configPda.toBuffer(),
              ],
              program.programId
            );

          const tokenVaultAta = getAssociatedTokenAddressSync(
            mintKeypair.publicKey,
            marketPda,
            true,
            TOKEN_2022_PROGRAM_ID
          );
          const args = {
            name: "Token name",
            symbol: symbol,
            uri: "https://example.org",
          };
          try {
            await program.methods
              .initializeMarket(args)
              .accountsPartial({
                config: config.configPda,
                tokenMint: mintKeypair.publicKey,
                tokenVault: tokenVaultAta,
                market: marketPda,
                nativeVault: nativeVaultPda,
              })
              .signers([mintKeypair])
              .rpc();
            expect.fail("should have failed");
          } catch (e) {
            expect(e instanceof anchor.AnchorError).to.be.true;
            const anchorError = e as anchor.AnchorError;
            expect(anchorError.error.errorCode.code).to.be.oneOf([
              "InvalidSymbol",
              "InvalidSymbolLength",
            ]);
          }
        });
      });
    });

    it("should failed if native vault mismatch", async () => {
      const mintKeypair = anchor.web3.Keypair.generate();
      const args = {
        name: "Token name",
        symbol: "TS" + nextSymbolIndex++,
        uri: "https://example.org",
      };
      const [marketPda, marketBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market"),
            Buffer.from(args.symbol),
            config.configPda.toBuffer(),
          ],
          program.programId
        );
      const [nativeVaultPda, nativeVaultBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market_vault"),
            Buffer.from(args.symbol + "OTHER"),
            config.configPda.toBuffer(),
          ],
          program.programId
        );
      const tokenVaultAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        marketPda,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      try {
        await program.methods
          .initializeMarket(args)
          .accountsPartial({
            config: config.configPda,
            tokenMint: mintKeypair.publicKey,
            tokenVault: tokenVaultAta,
            market: marketPda,
            nativeVault: nativeVaultPda,
          })
          .signers([mintKeypair])
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "NativeVaultAccountMismatch"
        );
      }
    });

    it("should succeed", async () => {
      const mintKeypair = anchor.web3.Keypair.generate();
      const args = {
        name: "Token name",
        symbol: "TS" + nextSymbolIndex++,
        uri: "https://example.org",
      };
      const [marketPda, marketBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market"),
            Buffer.from(args.symbol),
            config.configPda.toBuffer(),
          ],
          program.programId
        );
      const [nativeVaultPda, nativeVaultBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market_vault"),
            Buffer.from(args.symbol),
            config.configPda.toBuffer(),
          ],
          program.programId
        );
      const tokenVaultAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        marketPda,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      await program.methods
        .initializeMarket(args)
        .accountsPartial({
          config: config.configPda,
          tokenMint: mintKeypair.publicKey,
          tokenVault: tokenVaultAta,
          market: marketPda,
          nativeVault: nativeVaultPda,
        })
        .signers([mintKeypair])
        .rpc();

      const tokenVault = await getAccount(
        anchor.getProvider().connection,
        tokenVaultAta,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenVault.amount).to.eq(MAX_TOKEN_SUPPLY);

      const market = await program.account.market.fetch(marketPda);
      expect(market.config.toBase58()).to.eq(config.configPda.toBase58());
      expect(market.tokenMint.toBase58()).to.eq(
        mintKeypair.publicKey.toBase58()
      );
      expect(market.tokenVault.toBase58()).to.eq(tokenVaultAta.toBase58());
      expect(market.nativeVault.toBase58()).to.eq(nativeVaultPda.toBase58());
      expect(market.symbol).to.eq(args.symbol);
      expect(market.bump.length).to.eq(1);
      expect(market.bump[0]).to.eq(marketBump);
      expect(market.nativeVaultBump.length).to.eq(1);
      expect(market.nativeVaultBump[0]).to.eq(nativeVaultBump);
      expect(market.remainingSupply.toNumber()).to.eq(Number(MAX_TOKEN_SUPPLY));
      expect(market.transferHookEnabled).to.be.false;
      expect(market.freeTransferAllowed).to.be.true;

      const mint = await getMint(
        anchor.getProvider().connection,
        mintKeypair.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(mint.decimals).to.eq(DECIMALS);
      expect(mint.isInitialized).to.true;
      expect(mint.mintAuthority).to.null;
      expect(mint.freezeAuthority).to.null;
      expect(mint.supply).to.eq(MAX_TOKEN_SUPPLY);

      const state = getMetadataPointerState(mint);
      expect(state.metadataAddress).to.not.null;
      expect(state.authority!.toBase58()).to.eq(marketPda.toBase58());
      expect(state.metadataAddress!.toBase58()).to.eq(
        mintKeypair.publicKey.toBase58()
      );

      const metadata = await getTokenMetadata(
        program.provider.connection,
        state.metadataAddress,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(metadata).to.not.null;
      expect(metadata.name).to.eq(args.name);
      expect(metadata.symbol).to.eq(args.symbol);
      expect(metadata.uri).to.eq(args.uri);
    });
  });

  describe("#initialize_transfer_hook_market", () => {
    describe("should failed if symbol invalid", () => {
      [" ", "abc 123", "abc", "ABC ", "ABC 123"].forEach((symbol) => {
        it(`invalid symbol: ${symbol}`, async () => {
          const mintKeypair = anchor.web3.Keypair.generate();
          const [marketPda, marketBump] =
            anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("market"),
                Buffer.from(symbol),
                config.configPda.toBuffer(),
              ],
              program.programId
            );
          const [nativeVaultPda, nativeVaultBump] =
            anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("market_vault"),
                Buffer.from(symbol),
                config.configPda.toBuffer(),
              ],
              program.programId
            );

          const tokenVaultAta = getAssociatedTokenAddressSync(
            mintKeypair.publicKey,
            marketPda,
            true,
            TOKEN_2022_PROGRAM_ID
          );
          const args = {
            name: "Token name",
            symbol: symbol,
            uri: "https://example.org",
          };
          try {
            await program.methods
              .initializeTransferHookMarket(args)
              .accountsPartial({
                config: config.configPda,
                tokenMint: mintKeypair.publicKey,
                tokenVault: tokenVaultAta,
                market: marketPda,
                nativeVault: nativeVaultPda,
              })
              .signers([mintKeypair])
              .rpc();
            expect.fail("should have failed");
          } catch (e) {
            expect(e instanceof anchor.AnchorError).to.be.true;
            const anchorError = e as anchor.AnchorError;
            const number = anchorError.error.errorCode.number;
            expect(anchorError.error.errorCode.code).to.be.oneOf([
              "InvalidSymbol",
              "InvalidSymbolLength",
            ]);
          }
        });
      });
    });

    it("should failed if native vault mismatch", async () => {
      const mintKeypair = anchor.web3.Keypair.generate();
      const args = {
        name: "Token name",
        symbol: "TS" + nextSymbolIndex++,
        uri: "https://example.org",
      };
      const [marketPda, marketBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market"),
            Buffer.from(args.symbol),
            config.configPda.toBuffer(),
          ],
          program.programId
        );
      const [nativeVaultPda, nativeVaultBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market_vault"),
            Buffer.from(args.symbol + "OTHER"),
            config.configPda.toBuffer(),
          ],
          program.programId
        );
      const tokenVaultAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        marketPda,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      try {
        await program.methods
          .initializeTransferHookMarket(args)
          .accountsPartial({
            config: config.configPda,
            tokenMint: mintKeypair.publicKey,
            tokenVault: tokenVaultAta,
            market: marketPda,
            nativeVault: nativeVaultPda,
          })
          .signers([mintKeypair])
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "NativeVaultAccountMismatch"
        );
      }
    });

    it("should succeed", async () => {
      const mintKeypair = anchor.web3.Keypair.generate();
      const args = {
        name: "Token name",
        symbol: "TS" + nextSymbolIndex++,
        uri: "https://example.org",
      };
      const [marketPda, marketBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market"),
            Buffer.from(args.symbol),
            config.configPda.toBuffer(),
          ],
          program.programId
        );
      const [nativeVaultPda, nativeVaultBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market_vault"),
            Buffer.from(args.symbol),
            config.configPda.toBuffer(),
          ],
          program.programId
        );
      const tokenVaultAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        marketPda,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      await program.methods
        .initializeTransferHookMarket(args)
        .accountsPartial({
          config: config.configPda,
          tokenMint: mintKeypair.publicKey,
          tokenVault: tokenVaultAta,
          market: marketPda,
          nativeVault: nativeVaultPda,
        })
        .signers([mintKeypair])
        .rpc();

      const tokenVault = await getAccount(
        anchor.getProvider().connection,
        tokenVaultAta,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenVault.amount).to.eq(MAX_TOKEN_SUPPLY);

      const market = await program.account.market.fetch(marketPda);
      expect(market.config.toBase58()).to.eq(config.configPda.toBase58());
      expect(market.tokenMint.toBase58()).to.eq(
        mintKeypair.publicKey.toBase58()
      );
      expect(market.tokenVault.toBase58()).to.eq(tokenVaultAta.toBase58());
      expect(market.nativeVault.toBase58()).to.eq(nativeVaultPda.toBase58());
      expect(market.symbol).to.eq(args.symbol);
      expect(market.bump.length).to.eq(1);
      expect(market.bump[0]).to.eq(marketBump);
      expect(market.nativeVaultBump.length).to.eq(1);
      expect(market.nativeVaultBump[0]).to.eq(nativeVaultBump);
      expect(market.remainingSupply.toNumber()).to.eq(Number(MAX_TOKEN_SUPPLY));
      expect(market.transferHookEnabled).to.be.true;
      expect(market.freeTransferAllowed).to.be.false;

      const mint = await getMint(
        anchor.getProvider().connection,
        mintKeypair.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(mint.decimals).to.eq(DECIMALS);
      expect(mint.isInitialized).to.true;
      expect(mint.mintAuthority).to.null;
      expect(mint.freezeAuthority).to.null;
      expect(mint.supply).to.eq(MAX_TOKEN_SUPPLY);

      const state = getMetadataPointerState(mint);
      expect(state.metadataAddress).to.not.null;
      expect(state.authority!.toBase58()).to.eq(marketPda.toBase58());
      expect(state.metadataAddress!.toBase58()).to.eq(
        mintKeypair.publicKey.toBase58()
      );

      const metadata = await getTokenMetadata(
        program.provider.connection,
        state.metadataAddress,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(metadata).to.not.null;
      expect(metadata.name).to.eq(args.name);
      expect(metadata.symbol).to.eq(args.symbol);
      expect(metadata.uri).to.eq(args.uri);
    });
  });

  describe("#buy_token", () => {
    it("should failed if native vault account mismatch", async () => {
      const {
        mintKeypair,
        marketPda,
        marketBump,
        tokenVaultAta,
        extraAccountMetaListPda,
      } = await initializeMarket(config.configPda);

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyToken({
            buyAmount: new anchor.BN(1e9),
            maxPay: new anchor.BN(1e9),
          })
          .accountsPartial({
            config: config.configPda,
            market: marketPda,
            feeRecipient: config.feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient.address,
            nativeVault: wallet.publicKey,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "NativeVaultAccountMismatch"
        );
      }
    });

    it("should failed if token recipient account mismatch", async () => {
      const {
        marketPda,
        marketBump,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(config.configPda);
      const { mintKeypair: mintKeypairOther } = await initializeMarket(
        config.configPda,
        undefined,
        "OTHER" + nextSymbolIndex++,
        undefined
      );

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypairOther.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyToken({
            buyAmount: new anchor.BN(1e9),
            maxPay: new anchor.BN(1e9),
          })
          .accountsPartial({
            config: config.configPda,
            market: marketPda,
            feeRecipient: config.feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "TokenMintAccountMismatch"
        );
      }
    });

    it("should failed if fee recipient account mismatch", async () => {
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(config.configPda);

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyToken({
            buyAmount: new anchor.BN(1e9),
            maxPay: new anchor.BN(1e9),
          })
          .accountsPartial({
            config: config.configPda,
            market: marketPda,
            feeRecipient: tokenVaultAta,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "FeeRecipientMismatch"
        );
      }
    });

    it("should failed if token vault account mismatch", async () => {
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(config.configPda);
      const { tokenVaultAta: tokenVaultAtaOther } = await initializeMarket(
        config.configPda,
        undefined,
        "OTHER" + nextSymbolIndex++,
        undefined
      );

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyToken({
            buyAmount: new anchor.BN(1e9),
            maxPay: new anchor.BN(1e9),
          })
          .accountsPartial({
            config: config.configPda,
            market: marketPda,
            feeRecipient: config.feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAtaOther,
            tokenRecipient: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "TokenVaultAccountMismatch"
        );
      }
    });

    it("should failed if buy amount greater than remaining supply", async () => {
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(config.configPda);
      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyToken({
            buyAmount: new anchor.BN(
              new anchor.BN(MAX_TOKEN_SUPPLY.toString()).add(new anchor.BN(1))
            ),
            maxPay: new anchor.BN(0),
          })
          .accountsPartial({
            config: config.configPda,
            market: marketPda,
            feeRecipient: config.feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq("BuyAmountTooLarge");
      }
    });

    it("should failed if pay amount exceeds max pay", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 10e4;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const { y, fee, total } = compute_swap_with_fee(
        BigInt(1e9),
        MAX_TOKEN_SUPPLY,
        true
      );
      const ix1 = await program.methods
        .buyToken({
          buyAmount: new anchor.BN(1e9),
          maxPay: new anchor.BN((total - BigInt(1)).toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(buyTx, wallet, payer);
        expect.fail("should have failed");
      } catch (err) {
        expect(err instanceof anchor.web3.SendTransactionError).to.be.true;
        const sendTxError = err as anchor.web3.SendTransactionError;
        expect(sendTxError.message.includes("PayAmountExceedsMaxPay")).to.be
          .true;
      }
    });

    it("should failed if payer balance insufficient", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const { y, fee, total } = compute_swap_with_fee(
        MAX_TOKEN_SUPPLY / BigInt(10),
        MAX_TOKEN_SUPPLY,
        true
      );
      const ix1 = await program.methods
        .buyToken({
          buyAmount: new anchor.BN((MAX_TOKEN_SUPPLY / BigInt(10)).toString()),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(buyTx, wallet, payer);
        expect.fail("should have failed");
      } catch (err) {
        expect(err instanceof anchor.web3.SendTransactionError);
        const sendTxError = err as anchor.web3.SendTransactionError;
        expect(sendTxError.logs.join(" ").includes("insufficient lamports")).to
          .be.true;
      }
    });

    it("should failed if symbol is `BURN`", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const { y, fee, total } = compute_swap_with_fee(
        MAX_TOKEN_SUPPLY / BigInt(10),
        MAX_TOKEN_SUPPLY,
        true
      );
      const ix1 = await program.methods
        .buyToken({
          buyAmount: new anchor.BN((MAX_TOKEN_SUPPLY / BigInt(10)).toString()),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(buyTx, wallet, payer);
        expect.fail("should have failed");
      } catch (err) {
        expect(err instanceof anchor.web3.SendTransactionError).to.be.true;
        const sendTxError = err as anchor.web3.SendTransactionError;
        expect(sendTxError.message.includes("CannotUseThisInstruction")).to.be
          .true;
      }
    });

    it("should succeed", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 100;
      let tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      tx = await anchor
        .getProvider()
        .connection.requestAirdrop(feeRecipientKeypair.publicKey, 1e9);
      await confirmTransaction(tx);

      const nativeVaultBalanceBefore = await anchor
        .getProvider()
        .connection.getBalance(nativeVaultPda);
      const feeRecipientBalanceBefore = await anchor
        .getProvider()
        .connection.getBalance(feeRecipientKeypair.publicKey);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const { y, fee, total } = compute_swap_with_fee(
        BigInt(1e9),
        MAX_TOKEN_SUPPLY,
        true
      );
      const ix1 = await program.methods
        .buyToken({
          buyAmount: new anchor.BN(1e9),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          tokenMint: mintKeypair.publicKey,
        })
        .instruction();
      // ix1.keys.forEach((key) => {
      //   console.log(`${key.pubkey.toBase58()}`);
      // });
      // await addExtraAccountMetasForExecute(
      //   program.provider.connection,
      //   ix1,
      //   hookProgram.programId,
      //   tokenVaultAta,
      //   mintKeypair.publicKey,
      //   tokenRecipient,
      //   marketPda,
      //   1,
      //   undefined
      // );
      // console.log("after");
      // ix1.keys.forEach((key) => {
      //   console.log(`${key.pubkey.toBase58()}`);
      // });

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(buyTx, wallet, payer);

      const nativeVaultBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(nativeVaultPda);
      const feeRecipientBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(feeRecipientKeypair.publicKey);
      expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore).to.eq(
        Number(fee)
      );
      expect(nativeVaultBalanceAfter - nativeVaultBalanceBefore).to.eq(
        Number(y)
      );
      const payerBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(payer.publicKey);
      expect(payerBalanceBefore - payerBalanceAfter).to.eq(Number(total));

      const tokenRecipientBalanceAfter = await getAccount(
        anchor.getProvider().connection,
        tokenRecipient,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenRecipientBalanceAfter.amount).to.eq(BigInt(1e9));

      const tokenVaultBalanceAfter = await getAccount(
        anchor.getProvider().connection,
        tokenVaultAta,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenVaultBalanceAfter.amount + BigInt(1e9)).to.eq(
        MAX_TOKEN_SUPPLY
      );

      const { remainingSupply } = await program.account.market.fetch(marketPda);
      expect(remainingSupply.toNumber() + 1e9).to.eq(Number(MAX_TOKEN_SUPPLY));
    });
  });

  describe("#buy_token_exact_in", () => {
    it("should failed if native vault account mismatch", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        marketBump,
        tokenVaultAta,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyTokenExactIn({
            payAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(1e9),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient.address,
            nativeVault: wallet.publicKey,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "NativeVaultAccountMismatch"
        );
      }
    });

    it("should failed if token recipient account mismatch", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        marketPda,
        marketBump,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);
      const { mintKeypair: mintKeypairOther } = await initializeMarket(
        configPda,
        undefined,
        "OTHER" + nextSymbolIndex++,
        undefined
      );

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypairOther.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyTokenExactIn({
            payAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(1e9),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "TokenMintAccountMismatch"
        );
      }
    });

    it("should failed if fee recipient account mismatch", async () => {
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(config.configPda);

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyTokenExactIn({
            payAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(1e9),
          })
          .accountsPartial({
            config: config.configPda,
            market: marketPda,
            feeRecipient: tokenVaultAta,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "FeeRecipientMismatch"
        );
      }
    });

    it("should failed if token vault account mismatch", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);
      const { tokenVaultAta: tokenVaultAtaOther } = await initializeMarket(
        configPda,
        undefined,
        "OTHER" + nextSymbolIndex++,
        undefined
      );

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyTokenExactIn({
            payAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(1e9),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAtaOther,
            tokenRecipient: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "TokenVaultAccountMismatch"
        );
      }
    });

    it("should failed if pay amount is zero", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .buyTokenExactIn({
            payAmount: new anchor.BN(0),
            minReceive: new anchor.BN(1e9),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq("AmountCannotBeZero");
      }
    });

    it("should failed if receive too small", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 10e4;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const { buy_amount, y, fee, total } = compute_buy_token_exact_in_with_fee(
        BigInt(1e9),
        MAX_TOKEN_SUPPLY
      );
      const ix1 = await program.methods
        .buyTokenExactIn({
          payAmount: new anchor.BN(1e9),
          minReceive: new anchor.BN(Number(buy_amount) + 1),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(buyTx, wallet, payer);
        expect.fail("should have failed");
      } catch (err) {
        expect(err instanceof anchor.web3.SendTransactionError).to.be.true;
        let sterr = err as anchor.web3.SendTransactionError;
        expect(sterr.message.includes("ReceiveAmountTooSmall")).to.be.true;
      }
    });

    it("should failed if payer balance not enough", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e8;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const { buy_amount, y, fee, total } = compute_buy_token_exact_in_with_fee(
        BigInt(1e9),
        MAX_TOKEN_SUPPLY
      );
      const ix1 = await program.methods
        .buyTokenExactIn({
          payAmount: new anchor.BN(1e9),
          minReceive: new anchor.BN(Number(buy_amount) + 1),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(buyTx, wallet, payer);
        expect.fail("should have failed");
      } catch (err) {
        expect(err instanceof anchor.web3.SendTransactionError).to.be.true;
        let sterr = err as anchor.web3.SendTransactionError;
        expect(sterr.logs.some((log) => log.includes("insufficient lamports")))
          .to.be.true;
      }
    });

    it("should failed if symbol is `BURN`", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e8;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const { buy_amount, y, fee, total } = compute_buy_token_exact_in_with_fee(
        BigInt(1e9),
        MAX_TOKEN_SUPPLY
      );
      const ix1 = await program.methods
        .buyTokenExactIn({
          payAmount: new anchor.BN(1e9),
          minReceive: new anchor.BN(Number(buy_amount) + 1),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(buyTx, wallet, payer);
        expect.fail("should have failed");
      } catch (err) {
        expect(err instanceof anchor.web3.SendTransactionError).to.be.true;
        const sendTxError = err as anchor.web3.SendTransactionError;
        expect(sendTxError.message.includes("CannotUseThisInstruction")).to.be
          .true;
      }
    });

    it("should succeed", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 10e4;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const nativeVaultBalanceBefore = await anchor
        .getProvider()
        .connection.getBalance(nativeVaultPda);
      const feeRecipientBalanceBefore = await anchor
        .getProvider()
        .connection.getBalance(feeRecipientKeypair.publicKey);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const { buy_amount, y, fee, total } = compute_buy_token_exact_in_with_fee(
        BigInt(1e9),
        MAX_TOKEN_SUPPLY
      );
      const ix1 = await program.methods
        .buyTokenExactIn({
          payAmount: new anchor.BN(1e9),
          minReceive: new anchor.BN(Number(buy_amount)),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      const { signature } = await sendAndConfirmTransaction(
        buyTx,
        wallet,
        payer
      );
      // const txs = await anchor.getProvider().connection.getTransaction(signature, { commitment: "confirmed" })!;
      // console.log(`Transaction: ${JSON.stringify(txs, null, 2)}`);

      const nativeVaultBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(nativeVaultPda);
      const feeRecipientBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(feeRecipientKeypair.publicKey);
      expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore).to.eq(
        Number(fee)
      );
      expect(nativeVaultBalanceAfter - nativeVaultBalanceBefore).to.eq(
        Number(y)
      );
      const payerBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(payer.publicKey);
      expect(payerBalanceBefore - payerBalanceAfter).to.eq(Number(total));

      const tokenRecipientBalanceAfter = await getAccount(
        anchor.getProvider().connection,
        tokenRecipient,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenRecipientBalanceAfter.amount).to.eq(buy_amount);

      const tokenVaultBalanceAfter = await getAccount(
        anchor.getProvider().connection,
        tokenVaultAta,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenVaultBalanceAfter.amount + buy_amount).to.eq(
        MAX_TOKEN_SUPPLY
      );

      const { remainingSupply } = await program.account.market.fetch(marketPda);
      expect(remainingSupply.toNumber() + Number(buy_amount)).to.eq(
        Number(MAX_TOKEN_SUPPLY)
      );
    });

    it("should incorrect when multiple buy and sell tx", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 10e4;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const nativeVaultBalanceBefore = await anchor
        .getProvider()
        .connection.getBalance(nativeVaultPda);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const { buy_amount, y, fee, total } = compute_buy_token_exact_in_with_fee(
        BigInt(1e9),
        MAX_TOKEN_SUPPLY
      );

      for (let i = 0; i < 5; i++) {
        const buyTx = new anchor.web3.Transaction();
        if (i == 0) {
          buyTx.add(ix0);
        }
        const buyIx = await program.methods
          .buyTokenExactIn({
            payAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(Number(buy_amount)),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient,
            payer: payer.publicKey,
            nativeVault: nativeVaultPda,
          })
          .instruction();
        const sellIx = await program.methods
          .sellToken({
            sellAmount: new anchor.BN(Number(buy_amount)),
            minReceive: new anchor.BN(0),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            nativeRecipient: payer.publicKey,
            tokenPayer: tokenRecipient,
            payer: payer.publicKey,
            nativeVault: nativeVaultPda,
          })
          .instruction();
        buyTx.add(buyIx, sellIx);
        buyTx.feePayer = wallet.publicKey;
        const { signature } = await sendAndConfirmTransaction(
          buyTx,
          wallet,
          payer
        );
      }

      const nativeVaultBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(nativeVaultPda);
      expect(nativeVaultBalanceAfter - nativeVaultBalanceBefore).to.gt(0);

      const tokenRecipientBalanceAfter = await getAccount(
        anchor.getProvider().connection,
        tokenRecipient,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenRecipientBalanceAfter.amount).to.eq(BigInt(0));

      const tokenVaultBalanceAfter = await getAccount(
        anchor.getProvider().connection,
        tokenVaultAta,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenVaultBalanceAfter.amount).to.eq(MAX_TOKEN_SUPPLY);

      const { remainingSupply } = await program.account.market.fetch(marketPda);
      expect(remainingSupply.toNumber()).to.eq(Number(MAX_TOKEN_SUPPLY));
    });
  });

  describe("#buy_burn_exact_in", () => {
    it("should failed if token recipient is not black hole", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 1;
      let tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);
      tx = await anchor
        .getProvider()
        .connection.requestAirdrop(feeRecipientKeypair.publicKey, 1e9);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const ix1 = await program.methods
        .buyBurnExactIn({
          payAmount: new anchor.BN(1e8),
          minReceive: new anchor.BN(0),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();
      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(
          buyTx,
          wallet,
          payer,
          buyBurnAuthorityKeypair
        );
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.web3.SendTransactionError).to.be.true;
        const sendTxError = e as anchor.web3.SendTransactionError;
        expect(sendTxError.message.includes("MustBlackHoleOwner")).to.be.true;
      }
    });
  });

  describe("#buy_burn", () => {
    it("should failed if authority is not buy burn authority", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const [burnAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("burn_account"),
          payer.publicKey.toBuffer(),
          configPda.toBuffer(),
        ],
        program.programId
      );
      const ix1 = await program.methods
        .createBurnAccount()
        .accountsPartial({
          config: configPda,
          burnAccount: burnAccountPda,
          owner: payer.publicKey,
        })
        .instruction();

      const { y, fee, total } = compute_swap_with_fee(
        MAX_TOKEN_SUPPLY / BigInt(10),
        MAX_TOKEN_SUPPLY,
        true
      );
      const ix2 = await program.methods
        .buyBurn({
          nextNonce: 1,
          nextBuyAmount: new anchor.BN(
            (MAX_TOKEN_SUPPLY / BigInt(10)).toString()
          ),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: feeRecipientKeypair.publicKey,
          burnAccount: burnAccountPda,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1, ix2);
      buyTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(
          buyTx,
          wallet,
          payer,
          feeRecipientKeypair
        );
        expect.fail("should have failed");
      } catch (err) {
        expect(err instanceof anchor.web3.SendTransactionError).to.be.true;
        const sendTxError = err as anchor.web3.SendTransactionError;
        expect(sendTxError.message.includes("BuyBurnAuthorityMismatch")).to.be
          .true;
      }
    });
    it("should failed if symbol is not `BURN`", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda, undefined, "BURNN", undefined);

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const [burnAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("burn_account"),
          payer.publicKey.toBuffer(),
          configPda.toBuffer(),
        ],
        program.programId
      );
      const ix1 = await program.methods
        .createBurnAccount()
        .accountsPartial({
          config: configPda,
          burnAccount: burnAccountPda,
          owner: payer.publicKey,
        })
        .instruction();

      const { y, fee, total } = compute_swap_with_fee(
        MAX_TOKEN_SUPPLY / BigInt(10),
        MAX_TOKEN_SUPPLY,
        true
      );
      const ix2 = await program.methods
        .buyBurn({
          nextNonce: 1,
          nextBuyAmount: new anchor.BN(
            (MAX_TOKEN_SUPPLY / BigInt(10)).toString()
          ),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
          burnAccount: burnAccountPda,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1, ix2);
      buyTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(
          buyTx,
          wallet,
          payer,
          buyBurnAuthorityKeypair
        );
        expect.fail("should have failed");
      } catch (err) {
        expect(err instanceof anchor.web3.SendTransactionError).to.be.true;
        const sendTxError = err as anchor.web3.SendTransactionError;
        expect(sendTxError.message.includes("ConstraintSeeds.")).to.be.true;
      }
    });
    it("should failed if next nonce is incorrect", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9;
      let tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);
      tx = await anchor
        .getProvider()
        .connection.requestAirdrop(feeRecipientKeypair.publicKey, 1e9);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const [burnAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("burn_account"),
          payer.publicKey.toBuffer(),
          configPda.toBuffer(),
        ],
        program.programId
      );
      const ix1 = await program.methods
        .createBurnAccount()
        .accountsPartial({
          config: configPda,
          burnAccount: burnAccountPda,
          owner: payer.publicKey,
        })
        .instruction();

      const marketBefore = await program.account.market.fetch(marketPda);
      const { y, fee, total } = compute_swap_with_fee(
        1000e6,
        marketBefore.remainingSupply.toNumber(),
        true
      );
      const ix2 = await program.methods
        .buyBurn({
          nextNonce: 1,
          nextBuyAmount: new anchor.BN(1000e6),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
          burnAccount: burnAccountPda,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1, ix2);
      buyTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(
        buyTx,
        wallet,
        payer,
        buyBurnAuthorityKeypair
      );

      {
        const buyTx = new anchor.web3.Transaction().add(ix2);
        buyTx.feePayer = wallet.publicKey;
        try {
          await sendAndConfirmTransaction(
            buyTx,
            wallet,
            payer,
            buyBurnAuthorityKeypair
          );
          expect.fail("should have failed");
        } catch (err) {
          expect(err instanceof anchor.web3.SendTransactionError).to.be.true;
          const sendTxError = err as anchor.web3.SendTransactionError;
          expect(sendTxError.message.includes("NonceUnexpected")).to.be.true;
        }
      }
    });
    it("should failed when `free_transfer_allowed` is false", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9;
      let tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);
      tx = await anchor
        .getProvider()
        .connection.requestAirdrop(feeRecipientKeypair.publicKey, 1e9);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const [burnAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("burn_account"),
          payer.publicKey.toBuffer(),
          configPda.toBuffer(),
        ],
        program.programId
      );
      const ix1 = await program.methods
        .createBurnAccount()
        .accountsPartial({
          config: configPda,
          burnAccount: burnAccountPda,
          owner: payer.publicKey,
        })
        .instruction();

      const marketBefore = await program.account.market.fetch(marketPda);
      const { y, fee, total } = compute_swap_with_fee(
        1000e6,
        marketBefore.remainingSupply.toNumber(),
        true
      );
      const ix2 = await program.methods
        .buyBurn({
          nextNonce: 1,
          nextBuyAmount: new anchor.BN(1000e6),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
          burnAccount: burnAccountPda,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1, ix2);
      buyTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(
        buyTx,
        wallet,
        payer,
        buyBurnAuthorityKeypair
      );

      const feeTokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        feeRecipientKeypair.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const createATAIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        feeTokenRecipient,
        feeRecipientKeypair.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const transferCheckedIx =
        await createTransferCheckedWithTransferHookInstruction(
          program.provider.connection,
          tokenRecipient,
          mintKeypair.publicKey,
          feeTokenRecipient,
          payer.publicKey,
          BigInt(1e6),
          DECIMALS,
          undefined,
          undefined,
          TOKEN_2022_PROGRAM_ID
        );
      const transferCheckedTx = new anchor.web3.Transaction().add(
        createATAIx,
        transferCheckedIx
      );
      transferCheckedTx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(transferCheckedTx, wallet, payer);
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.web3.SendTransactionError).to.be.true;
        const sendTxError = e as anchor.web3.SendTransactionError;
        expect(sendTxError.message.includes("TransferNotAllowed")).to.be.true;
      }
    });
    it("should succeed when recipient is black hole", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9;
      let tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);
      tx = await anchor
        .getProvider()
        .connection.requestAirdrop(feeRecipientKeypair.publicKey, 1e9);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const [burnAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("burn_account"),
          payer.publicKey.toBuffer(),
          configPda.toBuffer(),
        ],
        program.programId
      );
      const ix1 = await program.methods
        .createBurnAccount()
        .accountsPartial({
          config: configPda,
          burnAccount: burnAccountPda,
          owner: payer.publicKey,
        })
        .instruction();

      const marketBefore = await program.account.market.fetch(marketPda);
      const { y, fee, total } = compute_swap_with_fee(
        1000e6,
        marketBefore.remainingSupply.toNumber(),
        true
      );
      const ix2 = await program.methods
        .buyBurn({
          nextNonce: 1,
          nextBuyAmount: new anchor.BN(1000e6),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
          burnAccount: burnAccountPda,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1, ix2);
      buyTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(
        buyTx,
        wallet,
        payer,
        buyBurnAuthorityKeypair
      );

      const blackHoleRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        BLACK_HOLE,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      const createATAIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        blackHoleRecipient,
        BLACK_HOLE,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const transferCheckedIx =
        await createTransferCheckedWithTransferHookInstruction(
          program.provider.connection,
          tokenRecipient,
          mintKeypair.publicKey,
          blackHoleRecipient,
          payer.publicKey,
          BigInt(1e6),
          DECIMALS,
          undefined,
          undefined,
          TOKEN_2022_PROGRAM_ID
        );
      const transferCheckedTx = new anchor.web3.Transaction().add(
        createATAIx,
        transferCheckedIx
      );
      transferCheckedTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(transferCheckedTx, wallet, payer);
      const account = await getAccount(
        anchor.getProvider().connection,
        blackHoleRecipient,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(account.amount).to.eq(BigInt(1e6));
    });
    it("should succeed", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 80000;
      let tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);
      tx = await anchor
        .getProvider()
        .connection.requestAirdrop(feeRecipientKeypair.publicKey, 1e9);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const [burnAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("burn_account"),
          payer.publicKey.toBuffer(),
          configPda.toBuffer(),
        ],
        program.programId
      );
      const ix1 = await program.methods
        .createBurnAccount()
        .accountsPartial({
          config: configPda,
          burnAccount: burnAccountPda,
          owner: payer.publicKey,
        })
        .instruction();

      let buy_amount = (MAX_TOKEN_SUPPLY * BigInt(98)) / BigInt(100);
      const marketBefore = await program.account.market.fetch(marketPda);
      const { y, fee, total } = compute_swap_with_fee(
        buy_amount,
        marketBefore.remainingSupply.toNumber(),
        true
      );
      const ix2 = await program.methods
        .buyBurn({
          nextNonce: 1,
          nextBuyAmount: new anchor.BN(buy_amount.toString()),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
          burnAccount: burnAccountPda,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();
      const blackHoleRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        BLACK_HOLE,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      // const ix3 = createAssociatedTokenAccountInstruction(
      //   wallet.publicKey,
      //   blackHoleRecipient,
      //   BLACK_HOLE,
      //   mintKeypair.publicKey,
      //   TOKEN_2022_PROGRAM_ID
      // );
      const ix4 = await program.methods
        .buyBurn({
          nextNonce: 2,
          nextBuyAmount: new anchor.BN(
            (buy_amount + MAX_TOKEN_SUPPLY / BigInt(100)).toString()
          ),
          maxPay: new anchor.BN(payerBalanceBefore.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: blackHoleRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
          burnAccount: burnAccountPda,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();
      const buyTx = new anchor.web3.Transaction().add(ix0, ix1, ix2, ix4);
      buyTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(
        buyTx,
        wallet,
        payer,
        buyBurnAuthorityKeypair
      );

      const market = await program.account.market.fetch(marketPda);
      expect(market.freeTransferAllowed).to.be.false; // funds still have assets
    });
    it("success using `use_funds_buy_burn`", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        BLACK_HOLE,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const ix1 = await program.methods
        .useFundsBuyBurn({
          maxBuyAmount: new anchor.BN(1000 * 1e6),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();
      const tx = new anchor.web3.Transaction();
      tx.add(ix1);
      await sendAndConfirmTransaction(tx, wallet, buyBurnAuthorityKeypair);

      const market = await program.account.market.fetch(marketPda);
      expect(market.freeTransferAllowed).to.be.false; // funds still have assets
    });
    it("success using `use_funds_buy_burn` and change `free_transfer_allowed` is true", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        BLACK_HOLE,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const ix1 = await program.methods
        .useFundsBuyBurn({
          maxBuyAmount: new anchor.BN(1000 * 1e6),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();
      const tx = new anchor.web3.Transaction();
      tx.add(ix1);
      await sendAndConfirmTransaction(tx, wallet, buyBurnAuthorityKeypair);

      const market = await program.account.market.fetch(marketPda);
      expect(market.freeTransferAllowed).to.be.true; // funds still have assets
    });
    it("success using `transfer_checked` instruction when `free_transfer_allowed` is true", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 100;
      let tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);
      tx = await anchor
        .getProvider()
        .connection.requestAirdrop(feeRecipientKeypair.publicKey, 1e9);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const [burnAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("burn_account"),
          payer.publicKey.toBuffer(),
          configPda.toBuffer(),
        ],
        program.programId
      );
      const ix1 = await program.methods
        .createBurnAccount()
        .accountsPartial({
          config: configPda,
          burnAccount: burnAccountPda,
          owner: payer.publicKey,
        })
        .instruction();

      const marketBefore = await program.account.market.fetch(marketPda);
      const { y, fee, total } = compute_swap_with_fee(
        1000e6,
        marketBefore.remainingSupply.toNumber(),
        true
      );
      const ix2 = await program.methods
        .buyBurn({
          nextNonce: 1,
          nextBuyAmount: new anchor.BN(1000e6),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
          burnAccount: burnAccountPda,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1, ix2);
      buyTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(
        buyTx,
        wallet,
        payer,
        buyBurnAuthorityKeypair
      );

      const feeTokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        feeRecipientKeypair.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const createATAIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        feeTokenRecipient,
        feeRecipientKeypair.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const transferCheckedIx =
        await createTransferCheckedWithTransferHookInstruction(
          program.provider.connection,
          tokenRecipient,
          mintKeypair.publicKey,
          feeTokenRecipient,
          payer.publicKey,
          BigInt(1e6),
          DECIMALS,
          undefined,
          undefined,
          TOKEN_2022_PROGRAM_ID
        );
      const transferCheckedTx = new anchor.web3.Transaction().add(
        createATAIx,
        transferCheckedIx
      );
      transferCheckedTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(transferCheckedTx, wallet, payer);

      const account = await getAccount(
        anchor.getProvider().connection,
        feeTokenRecipient,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(account.amount).to.eq(BigInt(1e6));
    });
    it("success using `buy_token` instruction when `free_transfer_allowed` is true", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 100;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const marketBefore = await program.account.market.fetch(marketPda);
      const { y, fee, total } = compute_swap_with_fee(
        1000e6,
        marketBefore.remainingSupply.toNumber(),
        true
      );
      const ix1 = await program.methods
        .buyToken({
          buyAmount: new anchor.BN(1000e6),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .remainingAccounts([
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
        ])
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(buyTx, wallet, payer);
      const account = await getAccount(
        anchor.getProvider().connection,
        tokenRecipient,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(account.amount).to.eq(BigInt(1000e6));
    });
    it("success using `buy_token_exact_in` instruction when `free_transfer_allowed` is true", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 100;
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const marketBefore = await program.account.market.fetch(marketPda);
      const { buy_amount } = compute_buy_token_exact_in_with_fee(
        1e9,
        marketBefore.remainingSupply.toNumber()
      );
      const ix1 = await program.methods
        .buyTokenExactIn({
          payAmount: new anchor.BN(1e9),
          minReceive: new anchor.BN(1),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .remainingAccounts([
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
        ])
        .instruction();

      const buyTx = new anchor.web3.Transaction().add(ix0, ix1);
      buyTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(buyTx, wallet, payer);
      const account = await getAccount(
        anchor.getProvider().connection,
        tokenRecipient,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(account.amount).to.eq(buy_amount);
    });
    it("success using `buy_burn_exact_in` instruction", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 1;
      let tx = await anchor
        .getProvider()
        .connection.requestAirdrop(payer.publicKey, payerBalanceBefore);
      await confirmTransaction(tx);
      tx = await anchor
        .getProvider()
        .connection.requestAirdrop(feeRecipientKeypair.publicKey, 1e9);
      await confirmTransaction(tx);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        BLACK_HOLE,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      // const ix0 = createAssociatedTokenAccountInstruction(
      //   wallet.publicKey,
      //   tokenRecipient,
      //   BLACK_HOLE,
      //   mintKeypair.publicKey,
      //   TOKEN_2022_PROGRAM_ID
      // );

      const ix1 = await program.methods
        .buyBurnExactIn({
          payAmount: new anchor.BN(1e8),
          minReceive: new anchor.BN(0),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
          buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,

          extraAccountMetaList: extraAccountMetaListPda,
        })
        .instruction();
      const buyTx = new anchor.web3.Transaction().add(ix1);
      buyTx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(
        buyTx,
        wallet,
        payer,
        buyBurnAuthorityKeypair
      );
    });
  });

  describe("#use_funds_buy_burn", () => {
    it("should failed owner is not black hole", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const payer = anchor.web3.Keypair.generate();
      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const ix0 = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      try {
        const ix1 = await program.methods
          .useFundsBuyBurn({
            maxBuyAmount: new anchor.BN(0),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient,
            nativeVault: nativeVaultPda,
            buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
            extraAccountMetaList: extraAccountMetaListPda,
          })
          .instruction();
        const tx = new anchor.web3.Transaction();
        tx.add(ix0, ix1);
        await sendAndConfirmTransaction(tx, wallet, buyBurnAuthorityKeypair);
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.web3.SendTransactionError).to.be.true;
        const sendTxError = e as anchor.web3.SendTransactionError;
        expect(sendTxError.message.includes("MustBlackHoleOwner")).to.be.true;
      }
    });
    it("should failed if max buy amount is 0", async () => {
      const { configPda, feeRecipientKeypair, buyBurnAuthorityKeypair } =
        await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = burn;

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        BLACK_HOLE,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      try {
        const ix1 = await program.methods
          .useFundsBuyBurn({
            maxBuyAmount: new anchor.BN(0),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            tokenRecipient: tokenRecipient,
            nativeVault: nativeVaultPda,
            buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
            extraAccountMetaList: extraAccountMetaListPda,
          })
          .instruction();
        const tx = new anchor.web3.Transaction();
        tx.add(ix1);
        await sendAndConfirmTransaction(tx, wallet, buyBurnAuthorityKeypair);
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.web3.SendTransactionError).to.be.true;
        const sendTxError = e as anchor.web3.SendTransactionError;
        expect(sendTxError.message.includes("AmountCannotBeZero")).to.be.true;
      }
    });
  });

  describe("#sell_token", () => {
    it("should failed if native vault account mismatch", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const { mintKeypair, marketPda, tokenVaultAta, extraAccountMetaListPda } =
        await initializeMarket(configPda);

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .sellToken({
            sellAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(0),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            nativeRecipient: wallet.publicKey,
            tokenPayer: tokenRecipient.address,
            nativeVault: wallet.publicKey,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "NativeVaultAccountMismatch"
        );
      }
    });

    it("should fail if token vault account mismatch", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);
      const { tokenVaultAta: tokenVaultAtaOther } = await initializeMarket(
        configPda,
        undefined,
        "OTHER" + nextSymbolIndex++,
        undefined
      );

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .sellToken({
            sellAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(0),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAtaOther,
            nativeRecipient: wallet.publicKey,
            tokenPayer: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "TokenVaultAccountMismatch"
        );
      }
    });

    it("should failed if fee recipient account mismatch", async () => {
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(config.configPda);

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .sellToken({
            sellAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(0),
          })
          .accountsPartial({
            config: config.configPda,
            market: marketPda,
            feeRecipient: tokenVaultAta,
            tokenVault: tokenVaultAta,
            nativeRecipient: wallet.publicKey,
            tokenPayer: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq(
          "FeeRecipientMismatch"
        );
      }
    });

    it("should failed if token payer mint mismatch", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);
      const { mintKeypair: mintKeypairOther } = await initializeMarket(
        configPda,
        undefined,
        "OTHER" + nextSymbolIndex++,
        undefined
      );
      const firstBuyerAtaOther = (
        await getOrCreateAssociatedTokenAccount(
          anchor.getProvider().connection,
          wallet,
          mintKeypairOther.publicKey,
          wallet.publicKey,
          undefined,
          undefined,
          undefined,
          TOKEN_2022_PROGRAM_ID,
          undefined
        )
      ).address;

      try {
        await program.methods
          .sellToken({
            sellAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(0),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            nativeRecipient: wallet.publicKey,
            tokenPayer: firstBuyerAtaOther,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.eq("ConstraintTokenMint");
      }
    });

    it("should failed if token payer authority mismatch", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        configPda,
        true,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .sellToken({
            sellAmount: new anchor.BN(1e9),
            minReceive: new anchor.BN(0),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            nativeRecipient: wallet.publicKey,
            tokenPayer: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.eq("ConstraintTokenOwner");
      }
    });

    it("should failed if sell amount is zero", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const tokenRecipient = await getOrCreateAssociatedTokenAccount(
        anchor.getProvider().connection,
        wallet,
        mintKeypair.publicKey,
        wallet.publicKey,
        undefined,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        undefined
      );
      try {
        await program.methods
          .sellToken({
            sellAmount: new anchor.BN(0),
            minReceive: new anchor.BN(0),
          })
          .accountsPartial({
            config: configPda,
            market: marketPda,
            feeRecipient: feeRecipientKeypair.publicKey,
            tokenVault: tokenVaultAta,
            nativeRecipient: wallet.publicKey,
            tokenPayer: tokenRecipient.address,
            nativeVault: nativeVaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const anchorError = e as anchor.AnchorError;
        expect(anchorError.error.errorCode.code).to.be.eq("AmountCannotBeZero");
      }
    });

    it("should failed if receive amount too small", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const payer = anchor.web3.Keypair.generate();
      const payerBalanceBefore = 1e9 * 1000e4;

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const createAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const buyAmount = BigInt(6e8) * BigInt(1e6);
      const { y, fee, total } = compute_swap_with_fee(
        buyAmount,
        MAX_TOKEN_SUPPLY,
        true
      );
      const buyIx = await program.methods
        .buyToken({
          buyAmount: new anchor.BN(buyAmount.toString()),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();
      const {
        y: sellY,
        fee: sellFee,
        total: sellTotal,
      } = compute_swap_with_fee(buyAmount, MAX_TOKEN_SUPPLY - buyAmount, false);
      const sellIx = await program.methods
        .sellToken({
          sellAmount: new anchor.BN(buyAmount.toString()),
          minReceive: new anchor.BN(Number(sellTotal) + 1),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          nativeRecipient: payer.publicKey,
          tokenPayer: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          // transfer token to buyer
          fromPubkey: wallet.publicKey,
          toPubkey: payer.publicKey,
          lamports: payerBalanceBefore,
        }),
        createAtaIx,
        buyIx,
        sellIx
      );
      tx.feePayer = wallet.publicKey;
      try {
        await sendAndConfirmTransaction(tx, wallet, payer);
        expect.fail("should have failed");
      } catch (err) {
        expect(err instanceof anchor.web3.SendTransactionError).to.be.true;
        let sterr = err as anchor.web3.SendTransactionError;
        expect(sterr.message.includes("ReceiveAmountTooSmall")).to.be.true;
      }
    });

    it("should succeed", async () => {
      const { configPda, feeRecipientKeypair } = await initializeConfig();
      const {
        mintKeypair,
        marketPda,
        tokenVaultAta,
        nativeVaultPda,
        extraAccountMetaListPda,
      } = await initializeMarket(configPda);

      const payer = anchor.web3.Keypair.generate();
      let payerBalanceBefore = 1e9 * 3000;

      let nativeVaultBalanceBefore = await anchor
        .getProvider()
        .connection.getBalance(nativeVaultPda);
      let feeRecipientBalanceBefore = await anchor
        .getProvider()
        .connection.getBalance(feeRecipientKeypair.publicKey);

      const tokenRecipient = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const createAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenRecipient,
        payer.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const buyAmount = BigInt(9e8) * BigInt(1e6);
      const { y, fee, total } = compute_swap_with_fee(
        buyAmount,
        MAX_TOKEN_SUPPLY,
        true
      );
      const buyIx = await program.methods
        .buyToken({
          buyAmount: new anchor.BN(buyAmount.toString()),
          maxPay: new anchor.BN(total.toString()),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          tokenRecipient: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();
      // await addExtraAccountMetasForExecute(
      //   program.provider.connection,
      //   buyIx,
      //   hookProgram.programId,
      //   tokenVaultAta,
      //   mintKeypair.publicKey,
      //   tokenRecipient,
      //   marketPda,
      //   1,
      //   undefined
      // );
      const {
        y: sellY,
        fee: sellFee,
        total: sellTotal,
      } = compute_swap_with_fee(buyAmount, MAX_TOKEN_SUPPLY - buyAmount, false);
      assert(y >= sellY);
      const payer2 = anchor.web3.Keypair.generate();
      const sellIx = await program.methods
        .sellToken({
          sellAmount: new anchor.BN(buyAmount.toString()),
          minReceive: new anchor.BN(Number(sellTotal)),
        })
        .accountsPartial({
          config: configPda,
          market: marketPda,
          feeRecipient: feeRecipientKeypair.publicKey,
          tokenVault: tokenVaultAta,
          nativeRecipient: payer2.publicKey,
          tokenPayer: tokenRecipient,
          payer: payer.publicKey,
          nativeVault: nativeVaultPda,
        })
        .instruction();
      // await addExtraAccountMetasForExecute(
      //   program.provider.connection,
      //   buyIx,
      //   hookProgram.programId,
      //   tokenRecipient,
      //   mintKeypair.publicKey,
      //   tokenVaultAta,
      //   marketPda,
      //   1,
      //   undefined
      // );

      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          // transfer token to buyer
          fromPubkey: wallet.publicKey,
          toPubkey: payer.publicKey,
          lamports: payerBalanceBefore,
        }),
        createAtaIx,
        buyIx
      );
      tx.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(tx, wallet, payer);

      let payerBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(payer.publicKey);
      // console.log(`before: ${payerBalanceBefore}, after: ${payerBalanceAfter}, buy_amount: ${y}, fee: ${fee}`);
      expect(payerBalanceBefore - payerBalanceAfter).to.eq(Number(y + fee));
      let feeRecipientBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(feeRecipientKeypair.publicKey);
      expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore).to.eq(
        Number(fee)
      );
      feeRecipientBalanceBefore = feeRecipientBalanceAfter;
      let nativeVaultBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(nativeVaultPda);
      expect(nativeVaultBalanceAfter - nativeVaultBalanceBefore).to.eq(
        Number(y)
      );
      nativeVaultBalanceBefore = nativeVaultBalanceAfter;
      payerBalanceBefore = payerBalanceAfter;

      const tx2 = new anchor.web3.Transaction().add(sellIx);
      tx2.feePayer = wallet.publicKey;
      await sendAndConfirmTransaction(tx2, wallet, payer);

      let payer2BalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(payer2.publicKey);
      payerBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(payer.publicKey);
      expect(payerBalanceAfter).to.eq(payerBalanceBefore);
      // console.log(`payer2 after: ${payer2BalanceAfter}, sell_amount: ${sellY}, fee: ${sellFee}`);
      feeRecipientBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(feeRecipientKeypair.publicKey);
      expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore).to.eq(
        Number(sellFee)
      );
      nativeVaultBalanceAfter = await anchor
        .getProvider()
        .connection.getBalance(nativeVaultPda);
      expect(nativeVaultBalanceBefore - nativeVaultBalanceAfter).to.eq(
        Number(sellY)
      );
      expect(payer2BalanceAfter).to.eq(Number(sellY - sellFee));

      const tokenRecipientBalanceAfter = await getAccount(
        anchor.getProvider().connection,
        tokenRecipient,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenRecipientBalanceAfter.amount).to.eq(BigInt(0));

      const tokenVaultBalanceAfter = await getAccount(
        anchor.getProvider().connection,
        tokenVaultAta,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(tokenVaultBalanceAfter.amount).to.eq(MAX_TOKEN_SUPPLY);

      const { remainingSupply } = await program.account.market.fetch(marketPda);
      expect(remainingSupply.toNumber()).to.eq(Number(MAX_TOKEN_SUPPLY));
    });
  });

  async function initializeConfig() {
    // check if config already initialized
    if (config !== null) {
      return config;
    }
    const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    const authorityKeypair = anchor.web3.Keypair.generate();
    const feeRecipientKeypair = anchor.web3.Keypair.generate();
    const buyBurnAuthorityKeypair = anchor.web3.Keypair.generate();
    await program.methods
      .initializeConfig({
        authority: authorityKeypair.publicKey,
        feeRecipient: feeRecipientKeypair.publicKey,
        buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
      })
      .accountsPartial({
        config: configPda,
      })
      .rpc();

    return {
      configPda,
      authorityKeypair,
      feeRecipientKeypair,
      buyBurnAuthorityKeypair,
    };
  }

  async function initializeMarket(
    configPublickey: anchor.web3.PublicKey,
    name: string = "Token name",
    symbol: string = "TS" + nextSymbolIndex++,
    uri: string = "https://example.org",
    transferHookEnabled: boolean = false
  ) {
    const mintKeypair = anchor.web3.Keypair.generate();
    const [marketPda, marketBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          Buffer.from(symbol),
          configPublickey.toBuffer(),
        ],
        program.programId
      );
    const [nativeVaultPda, nativeVaultBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("market_vault"),
          Buffer.from(symbol),
          configPublickey.toBuffer(),
        ],
        program.programId
      );
    const [extraAccountMetaListPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("extra-account-metas"), mintKeypair.publicKey.toBuffer()],
        hooksProgram.programId
      );
    const initializeAccountMetaListIx = await hooksProgram.methods
      .initializeAccountMetaList(symbol)
      .accountsPartial({
        tokenMint: mintKeypair.publicKey,
        extraAccountMetaList: extraAccountMetaListPda,
      })
      .instruction();

    const tokenVaultAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
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
          config: configPublickey,
          tokenMint: mintKeypair.publicKey,
          tokenVault: tokenVaultAta,
          market: marketPda,
          nativeVault: nativeVaultPda,
        })
        .instruction();
    } else {
      initializeMarketIx = await program.methods
        .initializeMarket(args)
        .accountsPartial({
          config: configPublickey,
          tokenMint: mintKeypair.publicKey,
          tokenVault: tokenVaultAta,
          market: marketPda,
          nativeVault: nativeVaultPda,
        })
        .instruction();
    }
    const tx = new anchor.web3.Transaction().add(initializeMarketIx);
    if (transferHookEnabled) {
      tx.add(initializeAccountMetaListIx);
    }
    await sendAndConfirmTransaction(tx, wallet, mintKeypair);
    return {
      mintKeypair,
      marketPda,
      marketBump,
      tokenVaultAta,
      nativeVaultPda,
      nativeVaultBump,
      extraAccountMetaListPda,
    };
  }

  async function sendAndConfirmTransaction(
    tx: anchor.web3.Transaction,
    ...signers: Array<anchor.web3.Keypair>
  ) {
    const { lastValidBlockHeight, blockhash } = await anchor
      .getProvider()
      .connection.getLatestBlockhash();
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.recentBlockhash = blockhash;
    tx.sign(...signers);
    const signature = await anchor
      .getProvider()
      .connection.sendRawTransaction(tx.serialize());
    await confirmTransaction(signature);
    return { signature };
  }
});

export async function confirmTransaction(
  signature: anchor.web3.TransactionSignature
) {
  const { lastValidBlockHeight, blockhash } = await anchor
    .getProvider()
    .connection.getLatestBlockhash();
  await anchor.getProvider().connection.confirmTransaction(
    {
      signature: signature,
      blockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight,
    },
    "confirmed"
  );
}
