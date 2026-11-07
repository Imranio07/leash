// Gives the test USDC mint a name in wallets: Metaplex token metadata
// (name "Leash Test USDC", symbol "tUSDC"). Run once, as the mint authority (OWNER_KEYPAIR).
//
//   npm run token-metadata
//
// Builds CreateMetadataAccountV3 by hand to avoid pulling in the Metaplex SDK.

import { getMint } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { explorerAddress, explorerTx, sendTx } from "@leash/sdk";
import { getConfig, loadKeypair } from "@leash/sdk/node";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const NAME = "Leash Test USDC";
const SYMBOL = "tUSDC";
const URI = "https://raw.githubusercontent.com/Imranio07/leash/main/docs/token/tusdc.json";
const CREATE_METADATA_ACCOUNT_V3 = 33;

function borshString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

function createMetadataIx(mint: PublicKey, authority: PublicKey): { ix: TransactionInstruction; metadata: PublicKey } {
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const sellerFee = Buffer.alloc(2); // u16 = 0
  const data = Buffer.concat([
    Buffer.from([CREATE_METADATA_ACCOUNT_V3]),
    // DataV2
    borshString(NAME),
    borshString(SYMBOL),
    borshString(URI),
    sellerFee,
    Buffer.from([0]), // creators: None
    Buffer.from([0]), // collection: None
    Buffer.from([0]), // uses: None
    Buffer.from([1]), // is_mutable: true
    Buffer.from([0]), // collection_details: None
  ]);
  const ix = new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false }, // mint authority
      { pubkey: authority, isSigner: true, isWritable: true }, // payer
      { pubkey: authority, isSigner: true, isWritable: false }, // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { ix, metadata };
}

async function main() {
  const cfg = getConfig();
  if (!cfg.mint) throw new Error('USDC_MINT is empty. Run "npm run setup" first.');
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const owner = loadKeypair(cfg.ownerKeypairPath);
  const mintInfo = await getMint(connection, cfg.mint);
  if (!mintInfo.mintAuthority?.equals(owner.publicKey)) {
    throw new Error("OWNER_KEYPAIR is not the mint authority (Circle USDC already has metadata).");
  }
  const { ix, metadata } = createMetadataIx(cfg.mint, owner.publicKey);
  if (await connection.getAccountInfo(metadata)) {
    console.log(`Metadata already exists: ${explorerAddress(metadata)}`);
    return;
  }
  const res = await sendTx(connection, [ix], [owner]);
  if (!res.ok) throw new Error(`CreateMetadataAccountV3 failed: ${res.error?.name}\n${res.logs.join("\n")}`);
  console.log(`${NAME} (${SYMBOL}) metadata created: ${explorerTx(res.signature)}`);
  console.log(`mint ${explorerAddress(cfg.mint)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
