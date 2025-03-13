import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FeeDistributor } from "../target/types/fee_distributor";
import { expect } from "chai";
import { confirmTransaction } from "./burn";

describe("fee-distributor", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.FeeDistributor as Program<FeeDistributor>;
  const wallet = anchor.Wallet.local().payer;

  let vaultPda: undefined | anchor.web3.PublicKey;
  let vaultBump: undefined | number;
  let authority: undefined | anchor.web3.Keypair;

  describe("#initialize_vault", () => {
    it("should succeed", async () => {
      await initializeVault();
      const vault = await program.account.vault.fetch(vaultPda);
      expect(vault.authority.toBase58()).to.eq(authority.publicKey.toBase58());
      expect(vault.bump[0]).to.eq(vaultBump);
    });

    it("should failed if initialize twice", async () => {
      const [vaultPda, vaultBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("vault")],
          program.programId
        );
      const authority = anchor.web3.Keypair.generate();
      await initializeVault();

      try {
        await program.methods
          .initializeVault({
            authority: authority.publicKey,
          })
          .accountsPartial({
            vault: vaultPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {}
    });
  });

  describe("#create_vault", () => {
    it("should succeed", async () => {
      await initializeVault();
      const owner = anchor.web3.Keypair.generate();
      const [ownerClaimPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("owner"), owner.publicKey.toBuffer()],
        program.programId
      );
      await program.methods
        .createAccount()
        .accountsPartial({
          owner: owner.publicKey,
          claim: ownerClaimPda,
        })
        .rpc();
      const { nonce, claimed } = await program.account.claim.fetch(
        ownerClaimPda
      );
      expect(nonce).to.be.eq(0);
      expect(claimed.toNumber()).to.be.eq(0);
    });

    it("should failed if create account twice", async () => {
      await initializeVault();
      const owner = anchor.web3.Keypair.generate();
      const [ownerClaimPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("owner"), owner.publicKey.toBuffer()],
        program.programId
      );
      await program.methods
        .createAccount()
        .accountsPartial({
          owner: owner.publicKey,
          claim: ownerClaimPda,
        })
        .rpc();

      try {
        await program.methods
          .createAccount()
          .accountsPartial({
            owner: owner.publicKey,
            claim: ownerClaimPda,
          })
          .rpc();
        expect.fail("should have failed");
      } catch (e) {}
    });
  });

  describe("#update_claim", () => {
    it("should failed if vault not initialize", async () => {
      const { owner, ownerClaimPda } = await createAccount();
      const fakeVault = anchor.web3.Keypair.generate();
      try {
        await program.methods
          .updateClaim({
            nextNonce: 1,
            nextClaimed: new anchor.BN(1),
          })
          .accountsPartial({
            vault: fakeVault.publicKey,
            claim: ownerClaimPda,
            authority: fakeVault.publicKey,
            owner: owner.publicKey,
            recipient: fakeVault.publicKey,
          })
          .signers([wallet, owner, fakeVault])
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const err = e as anchor.AnchorError;
        expect(err.message).to.include(
          "AccountNotInitialized. Error Number: 3012"
        );
      }
    });

    it("should failed if authority mismatch", async () => {
      await initializeVault();
      const { owner, ownerClaimPda } = await createAccount();
      const fakeAuthority = anchor.web3.Keypair.generate();
      try {
        await program.methods
          .updateClaim({
            nextNonce: 1,
            nextClaimed: new anchor.BN(1),
          })
          .accountsPartial({
            vault: vaultPda,
            claim: ownerClaimPda,
            authority: fakeAuthority.publicKey,
            owner: owner.publicKey,
            recipient: owner.publicKey,
          })
          .signers([wallet, owner, fakeAuthority])
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const err = e as anchor.AnchorError;
        expect(err.message).to.be.include("Error Code: MissingAuthority");
      }
    });

    it("should failed if claim account incorrect", async () => {
      await initializeVault();
      const { owner, ownerClaimPda } = await createAccount();
      const fakeOwner = anchor.web3.Keypair.generate();
      try {
        await program.methods
          .updateClaim({
            nextNonce: 1,
            nextClaimed: new anchor.BN(1),
          })
          .accountsPartial({
            vault: vaultPda,
            claim: ownerClaimPda,
            authority: authority.publicKey,
            owner: fakeOwner.publicKey,
            recipient: fakeOwner.publicKey,
          })
          .signers([wallet, fakeOwner, authority])
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const err = e as anchor.AnchorError;
        expect(err.message).to.be.include(
          "Error Code: ConstraintSeeds. Error Number: 2006"
        );
      }
    });

    it("should failed if next nonce incorrect", async () => {
      await initializeVault();
      const { owner, ownerClaimPda } = await createAccount();
      try {
        await program.methods
          .updateClaim({
            nextNonce: 2,
            nextClaimed: new anchor.BN(1),
          })
          .accountsPartial({
            vault: vaultPda,
            claim: ownerClaimPda,
            authority: authority.publicKey,
            owner: owner.publicKey,
            recipient: owner.publicKey,
          })
          .signers([wallet, owner, authority])
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const err = e as anchor.AnchorError;
        expect(err.message).to.be.include("Error Code: NonceUnexpected");
      }
    });

    it("should failed if vault insufficient", async () => {
      await initializeVault();
      const { owner, ownerClaimPda } = await createAccount();
      try {
        await program.methods
          .updateClaim({
            nextNonce: 1,
            nextClaimed: new anchor.BN(1),
          })
          .accountsPartial({
            vault: vaultPda,
            claim: ownerClaimPda,
            authority: authority.publicKey,
            owner: owner.publicKey,
            recipient: owner.publicKey,
          })
          .signers([wallet, owner, authority])
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.web3.SendTransactionError);
        const err = e as anchor.web3.SendTransactionError;
        expect(err.message).to.be.include("with insufficient funds for rent");
      }
    });

    it("should failed if next claimed incorrect", async () => {
      await initializeVault();
      const { owner, ownerClaimPda } = await createAccount();
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(vaultPda, 1e9 * 2);
      await confirmTransaction(tx);

      const recipient = anchor.web3.Keypair.generate();
      await program.methods
        .updateClaim({
          nextNonce: 1,
          nextClaimed: new anchor.BN(1e9),
        })
        .accountsPartial({
          vault: vaultPda,
          claim: ownerClaimPda,
          authority: authority.publicKey,
          owner: owner.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([wallet, owner, authority])
        .rpc();

      try {
        await program.methods
          .updateClaim({
            nextNonce: 2,
            nextClaimed: new anchor.BN(1e9),
          })
          .accountsPartial({
            vault: vaultPda,
            claim: ownerClaimPda,
            authority: authority.publicKey,
            owner: owner.publicKey,
            recipient: recipient.publicKey,
          })
          .signers([wallet, owner, authority])
          .rpc();
        expect.fail("should have failed");
      } catch (e) {
        expect(e instanceof anchor.AnchorError).to.be.true;
        const err = e as anchor.AnchorError;
        expect(err.message).to.be.include(
          "Error Code: ClaimedAmountUnexpected"
        );
      }
    });

    it("should succeed", async () => {
      await initializeVault();
      const { owner, ownerClaimPda } = await createAccount();
      const tx = await anchor
        .getProvider()
        .connection.requestAirdrop(vaultPda, anchor.web3.LAMPORTS_PER_SOL * 10);
      await confirmTransaction(tx);

      let balanceBefore = await program.provider.connection.getBalance(
        vaultPda
      );

      let recipient = anchor.web3.Keypair.generate();
      await program.methods
        .updateClaim({
          nextNonce: 1,
          nextClaimed: new anchor.BN(1e9),
        })
        .accountsPartial({
          vault: vaultPda,
          claim: ownerClaimPda,
          authority: authority.publicKey,
          owner: owner.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([wallet, owner, authority])
        .rpc();
      let balanceAfter = await program.provider.connection.getBalance(vaultPda);
      expect(balanceBefore - balanceAfter).to.eq(1e9);
      expect(
        await program.provider.connection.getBalance(recipient.publicKey)
      ).to.eq(1e9);
      let { nonce, claimed } = await program.account.claim.fetch(ownerClaimPda);
      expect(nonce).to.eq(1);
      expect(claimed.toNumber()).to.eq(1e9);
      balanceBefore = balanceAfter;

      recipient = anchor.web3.Keypair.generate();
      await program.methods
        .updateClaim({
          nextNonce: 2,
          nextClaimed: new anchor.BN(2e9),
        })
        .accountsPartial({
          vault: vaultPda,
          claim: ownerClaimPda,
          authority: authority.publicKey,
          owner: owner.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([wallet, owner, authority])
        .rpc();
      balanceAfter = await program.provider.connection.getBalance(vaultPda);
      expect(balanceBefore - balanceAfter).to.eq(1e9);
      expect(
        await program.provider.connection.getBalance(recipient.publicKey)
      ).to.eq(1e9);
      let { nonce: nextNonce, claimed: nextClaimed } =
        await program.account.claim.fetch(ownerClaimPda);
      expect(nextNonce).to.eq(2);
      expect(nextClaimed.toNumber()).to.eq(2e9);
    });
  });

  async function initializeVault() {
    if (vaultPda != undefined) {
      return;
    }
    const [vaultPdaLocal, vaultBumpLocal] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        program.programId
      );
    vaultPda = vaultPdaLocal;
    vaultBump = vaultBumpLocal;
    authority = anchor.web3.Keypair.generate();
    await program.methods
      .initializeVault({
        authority: authority.publicKey,
      })
      .accountsPartial({
        vault: vaultPdaLocal,
      })
      .rpc();
  }

  async function createAccount() {
    const owner = anchor.web3.Keypair.generate();
    const [ownerClaimPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("owner"), owner.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .createAccount()
      .accountsPartial({
        owner: owner.publicKey,
        claim: ownerClaimPda,
      })
      .rpc();
    return { owner, ownerClaimPda };
  }
});
