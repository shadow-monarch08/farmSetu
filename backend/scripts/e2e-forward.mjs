import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import algosdk from "algosdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const textEncoder = new TextEncoder();

const algodServer = process.env.ALGOD_SERVER || "https://testnet-api.algonode.cloud";
const algodToken = process.env.ALGOD_TOKEN || "";
const algodPort = process.env.ALGOD_PORT || "";

const farmerMnemonic = process.env.FARMER_MNEMONIC || "";
const buyerMnemonic = process.env.BUYER_MNEMONIC || "";
const oracleMnemonic = process.env.ORACLE_MNEMONIC || "";

const cropName = process.env.CROP_NAME || "WHEAT";
const quantity = Number(process.env.QUANTITY || "100");
const agreedPriceAlgo = Number(process.env.AGREED_PRICE || "10");
const updatedPriceAlgo = Number(process.env.UPDATED_PRICE || "12");

if (!farmerMnemonic || !buyerMnemonic || !oracleMnemonic) {
  throw new Error("Missing FARMER_MNEMONIC, BUYER_MNEMONIC, or ORACLE_MNEMONIC");
}

const algod = new algosdk.Algodv2(algodToken, algodServer, algodPort);
const farmer = algosdk.mnemonicToSecretKey(farmerMnemonic);
const buyer = algosdk.mnemonicToSecretKey(buyerMnemonic);
const oracle = algosdk.mnemonicToSecretKey(oracleMnemonic);

const agreedPriceMicro = Math.round(agreedPriceAlgo * 1_000_000);
const updatedPriceMicro = Math.round(updatedPriceAlgo * 1_000_000);
const depositMicro = quantity * agreedPriceMicro;

const approvalPath = path.resolve(__dirname, "..", "contracts", "forward", "approval.teal");
const clearPath = path.resolve(__dirname, "..", "contracts", "forward", "clear.teal");
const approvalSource = await readFile(approvalPath, "utf8");
const clearSource = await readFile(clearPath, "utf8");

console.log("Compiling TEAL...");
const [approvalCompiled, clearCompiled] = await Promise.all([
  algod.compile(approvalSource).do(),
  algod.compile(clearSource).do(),
]);

const approvalProgram = algosdk.base64ToBytes(approvalCompiled.result);
const clearProgram = algosdk.base64ToBytes(clearCompiled.result);

console.log("1) Creating forward contract app...");
let params = await algod.getTransactionParams().do();
const createTxn = algosdk.makeApplicationCreateTxnFromObject({
  sender: farmer.addr,
  approvalProgram,
  clearProgram,
  numGlobalInts: 7,
  numGlobalByteSlices: 4,
  numLocalInts: 0,
  numLocalByteSlices: 0,
  onComplete: algosdk.OnApplicationComplete.NoOpOC,
  appArgs: [
    textEncoder.encode("create"),
    algosdk.decodeAddress(oracle.addr).publicKey,
    textEncoder.encode(cropName),
    algosdk.encodeUint64(quantity),
    algosdk.encodeUint64(agreedPriceMicro),
  ],
  suggestedParams: params,
});

const createSigned = createTxn.signTxn(farmer.sk);
const createSubmitted = await algod.sendRawTransaction(createSigned).do();
const createConfirmed = await algosdk.waitForConfirmation(algod, createSubmitted.txid, 8);
const appId = Number(createConfirmed.applicationIndex);
console.log(`   APP_ID=${appId}`);

console.log("2) Buyer accepts contract with grouped payment...");
params = await algod.getTransactionParams().do();
const appAddress = algosdk.getApplicationAddress(appId);
const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  sender: buyer.addr,
  receiver: appAddress,
  amount: depositMicro,
  suggestedParams: params,
});
const acceptTxn = algosdk.makeApplicationNoOpTxnFromObject({
  sender: buyer.addr,
  appIndex: appId,
  appArgs: [textEncoder.encode("accept")],
  suggestedParams: params,
});
algosdk.assignGroupID([paymentTxn, acceptTxn]);
const buyerSignedPayment = paymentTxn.signTxn(buyer.sk);
const buyerSignedAccept = acceptTxn.signTxn(buyer.sk);
const acceptSubmitted = await algod.sendRawTransaction([buyerSignedPayment, buyerSignedAccept]).do();
await algosdk.waitForConfirmation(algod, acceptSubmitted.txid, 8);
console.log(`   ACCEPT_TX=${acceptSubmitted.txid}`);

console.log("3) Oracle updates price...");
params = await algod.getTransactionParams().do();
const updateTxn = algosdk.makeApplicationNoOpTxnFromObject({
  sender: oracle.addr,
  appIndex: appId,
  appArgs: [textEncoder.encode("update_price"), algosdk.encodeUint64(updatedPriceMicro)],
  suggestedParams: params,
});
const updateSigned = updateTxn.signTxn(oracle.sk);
const updateSubmitted = await algod.sendRawTransaction(updateSigned).do();
await algosdk.waitForConfirmation(algod, updateSubmitted.txid, 8);
console.log(`   ORACLE_TX=${updateSubmitted.txid}`);

console.log("4) Farmer settles contract...");
params = await algod.getTransactionParams().do();
const settleTxn = algosdk.makeApplicationNoOpTxnFromObject({
  sender: farmer.addr,
  appIndex: appId,
  appArgs: [textEncoder.encode("settle")],
  suggestedParams: { ...params, flatFee: true, fee: 2_000 },
});
const settleSigned = settleTxn.signTxn(farmer.sk);
const settleSubmitted = await algod.sendRawTransaction(settleSigned).do();
await algosdk.waitForConfirmation(algod, settleSubmitted.txid, 8);
console.log(`   SETTLE_TX=${settleSubmitted.txid}`);

console.log("E2E completed.");
console.log(`APP_ID=${appId}`);
console.log(`AGREED_PRICE_ALGO=${agreedPriceAlgo}`);
console.log(`UPDATED_PRICE_ALGO=${updatedPriceAlgo}`);
