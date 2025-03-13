import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Burn } from "../target/types/burn";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

// Configure the client to use the local cluster.
anchor.setProvider(anchor.AnchorProvider.env());

async function deploy() {
  const network = process.argv[2];
  console.log(`Network: ${network}`);

  const feeDistributorFilename = `deployments/fee-distributor-${network}.json`;
  const fs = require("fs");
  if (!fs.existsSync(feeDistributorFilename)) {
    throw new Error(
      `Fee distributor deployment file not found: ${feeDistributorFilename}`
    );
  }
  const feeDistributorDeployment = JSON.parse(
    fs.readFileSync(feeDistributorFilename, "utf-8")
  );
  const feeRecipient = new anchor.web3.PublicKey(
    feeDistributorDeployment.vault.address
  );
  console.log(`Fee recipient: ${feeRecipient}`);

  const program = anchor.workspace.Burn as Program<Burn>;
  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const authorityKeypair = anchor.web3.Keypair.generate();
  const buyBurnAuthorityKeypair = anchor.web3.Keypair.generate();

  // print process.argv
  process.argv.forEach(function (val, index, array) {
    console.log(index + ": " + val);
  });
  fs.writeFileSync(
    `deployments/${network}.json`,
    JSON.stringify(
      {
        config: configPda.toBase58(),
        authority: {
          publicKey: authorityKeypair.publicKey.toBase58(),
          privateKey: bs58.encode(authorityKeypair.secretKey),
        },
        feeRecipient: feeRecipient.toBase58(),
        buyBurnAuthority: {
          publicKey: buyBurnAuthorityKeypair.publicKey.toBase58(),
          privateKey: bs58.encode(buyBurnAuthorityKeypair.secretKey),
        },
      },
      null,
      4
    )
  );

  const sig = await program.methods
    .initializeConfig({
      authority: authorityKeypair.publicKey,
      feeRecipient: feeRecipient,
      buyBurnAuthority: buyBurnAuthorityKeypair.publicKey,
    })
    .accountsPartial({
      config: configPda,
    })
    .rpc();
  console.log(`Transaction: ${sig}`);
  console.log(`✅ Successfully deployed!`);
}

deploy()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
