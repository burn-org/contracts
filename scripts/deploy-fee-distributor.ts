import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FeeDistributor } from "../target/types/fee_distributor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

// Configure the client to use the local cluster.
anchor.setProvider(anchor.AnchorProvider.env());

async function deploy() {
  const network = process.argv[2];
  console.log(`Network: ${network}`);
  const program = anchor.workspace.FeeDistributor as Program<FeeDistributor>;
  const authority = anchor.web3.Keypair.generate();
  const [vaultPda, vaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );
  const fs = require("fs");
  if (!fs.existsSync("deployments")) {
    fs.mkdirSync("deployments");
  }
  const filename = `deployments/fee-distributor-${network}.json`;
  if (fs.existsSync(filename)) {
    throw new Error(`Deployment file already exists: ${filename}`);
  }

  fs.writeFileSync(
    filename,
    JSON.stringify(
      {
        vault: {
          address: vaultPda.toBase58(),
          bump: vaultBump,
        },
        authority: {
          publicKey: authority.publicKey.toBase58(),
          privateKey: bs58.encode(authority.secretKey),
        },
      },
      null,
      4
    )
  );
  const sig = await program.methods
    .initializeVault({
      authority: authority.publicKey,
    })
    .accountsPartial({
      vault: vaultPda,
    })
    .rpc();
  console.log(`Transaction ${sig}`);

  console.log(`✅ Successfully deployed!`);
}

deploy()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
