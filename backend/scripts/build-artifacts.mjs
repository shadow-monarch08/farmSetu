import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import algosdk from "algosdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const algodServer = process.env.ALGOD_SERVER || "https://testnet-api.algonode.cloud";
const algodToken = process.env.ALGOD_TOKEN || "";
const algodPort = process.env.ALGOD_PORT || "";

const algod = new algosdk.Algodv2(algodToken, algodServer, algodPort);

async function compileContract(name, approvalPath, clearPath) {
  console.log(`Compiling ${name} contract...`);

  const approvalSource = await readFile(approvalPath, "utf8");
  const clearSource = await readFile(clearPath, "utf8");

  const [approvalCompiled, clearCompiled] = await Promise.all([
    algod.compile(approvalSource).do(),
    algod.compile(clearSource).do(),
  ]);

  const approvalProgram = algosdk.base64ToBytes(approvalCompiled.result);
  const clearProgram = algosdk.base64ToBytes(clearCompiled.result);

  return {
    approvalProgram,
    clearProgram,
    approvalHash: approvalCompiled.hash,
    clearHash: clearCompiled.hash,
  };
}

async function buildArtifacts() {
  const artifactsDir = path.resolve(__dirname, "..", "..", "artifacts");

  // Create artifacts directory
  await mkdir(artifactsDir, { recursive: true });

  // Compile forward contract
  const forwardApprovalPath = path.resolve(__dirname, "..", "contracts", "forward", "approval.teal");
  const forwardClearPath = path.resolve(__dirname, "..", "contracts", "forward", "clear.teal");

  const forwardContract = await compileContract("forward", forwardApprovalPath, forwardClearPath);

  // Save artifacts
  const forwardArtifact = {
    name: "FarmSetu Forward Contract",
    version: "1.0.0",
    network: process.env.ALGOD_SERVER?.includes("testnet") ? "testnet" : "mainnet",
    compiledAt: new Date().toISOString(),
    approvalProgram: Array.from(forwardContract.approvalProgram),
    clearProgram: Array.from(forwardContract.clearProgram),
    approvalHash: forwardContract.approvalHash,
    clearHash: forwardContract.clearHash,
    globalStateSchema: {
      numInts: 7,
      numByteSlices: 4,
    },
    localStateSchema: {
      numInts: 0,
      numByteSlices: 0,
    },
    methods: [
      {
        name: "create",
        args: ["oracle_address", "crop_name", "quantity", "agreed_price"],
        description: "Create a new forward contract"
      },
      {
        name: "accept",
        args: [],
        description: "Accept the contract (buyer deposits funds)"
      },
      {
        name: "update_price",
        args: ["current_price"],
        description: "Update current market price (oracle only)"
      },
      {
        name: "settle",
        args: [],
        description: "Settle the contract based on price difference"
      }
    ]
  };

  const artifactPath = path.join(artifactsDir, "forward-contract.json");
  await writeFile(artifactPath, JSON.stringify(forwardArtifact, null, 2));

  console.log(`✅ Artifacts generated successfully!`);
  console.log(`📁 Saved to: ${artifactPath}`);
  console.log(`📋 Contract Details:`);
  console.log(`   - Approval Program Hash: ${forwardContract.approvalHash}`);
  console.log(`   - Clear Program Hash: ${forwardContract.clearHash}`);
  console.log(`   - Global Ints: 7, Global ByteSlices: 4`);
  console.log(`   - Local Ints: 0, Local ByteSlices: 0`);
}

buildArtifacts().catch(console.error);