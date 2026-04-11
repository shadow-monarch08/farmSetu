import algosdk, { base64ToBytes, bytesToString } from "algosdk";
import type {
  CreateContractInput,
  AcceptContractInput,
  UpdatePriceInput,
  SettleContractInput,
  FarmSetuForwardContract,
} from "../types/contract";
import type { WalletInstance } from "../hooks/useWallet";
import { algodClient, FORWARD_APP_ID, indexerClient, isOnChainMode } from "./networkConfig";
import { FORWARD_APPROVAL_TEAL, FORWARD_CLEAR_TEAL } from "./tealSources";
import { algoToMicroAlgos, microAlgosToAlgo } from "../utils/units";

const STORAGE_KEY = "farmsetu_contracts";
const NEXT_ID_KEY = "farmsetu_next_contract_id";
const KNOWN_APP_IDS_KEY = "farmsetu_known_app_ids";
const ADDRESS_REGEX = /^[A-Z2-7]{58}$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type SignerTransaction = { txn: algosdk.Transaction; signers?: string[]; authAddr?: string };

let compiledApprovalProgram: Uint8Array | null = null;
let compiledClearProgram: Uint8Array | null = null;

function hasWindow() {
  return typeof window !== "undefined";
}

function asUint8(value: Uint8Array | number[]) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function ensureAddress(address: string, name: string) {
  if (!ADDRESS_REGEX.test(address)) {
    throw new Error(`${name} is not a valid Algorand address.`);
  }
}

function toRound(value: number | bigint | undefined): number | undefined {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : undefined;
}

async function sendTransactions(
  wallet: WalletInstance,
  txns: SignerTransaction[],
  signerAddress?: string
): Promise<string> {
  const signed = await wallet.signTransaction([txns], signerAddress);
  const result = await algodClient.sendRawTransaction(signed).do();
  return result.txid as string;
}

async function waitConfirmed(txId: string) {
  return algosdk.waitForConfirmation(algodClient, txId, 6);
}

async function ensureCompiledPrograms() {
  if (compiledApprovalProgram && compiledClearProgram) {
    return { approvalProgram: compiledApprovalProgram, clearProgram: compiledClearProgram };
  }

  const approvalCompiled = await algodClient.compile(FORWARD_APPROVAL_TEAL).do();
  const clearCompiled = await algodClient.compile(FORWARD_CLEAR_TEAL).do();

  compiledApprovalProgram = base64ToBytes(approvalCompiled.result);
  compiledClearProgram = base64ToBytes(clearCompiled.result);

  return { approvalProgram: compiledApprovalProgram, clearProgram: compiledClearProgram };
}

function readKnownAppIds(): number[] {
  if (!hasWindow()) return [];
  const raw = window.localStorage.getItem(KNOWN_APP_IDS_KEY);
  if (!raw) return FORWARD_APP_ID > 0 ? [FORWARD_APP_ID] : [];

  try {
    const parsed = JSON.parse(raw) as number[];
    const ids = parsed.filter((id) => Number.isInteger(id) && id > 0);
    if (FORWARD_APP_ID > 0 && !ids.includes(FORWARD_APP_ID)) {
      ids.unshift(FORWARD_APP_ID);
    }
    return Array.from(new Set(ids));
  } catch {
    return FORWARD_APP_ID > 0 ? [FORWARD_APP_ID] : [];
  }
}

function writeKnownAppIds(ids: number[]) {
  if (!hasWindow()) return;
  const uniq = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  window.localStorage.setItem(KNOWN_APP_IDS_KEY, JSON.stringify(uniq));
}

function rememberAppId(appId: number) {
  const existing = readKnownAppIds();
  if (!existing.includes(appId)) {
    writeKnownAppIds([appId, ...existing]);
  }
}

function appStatusFromNumber(value: number): FarmSetuForwardContract["contract_status"] {
  if (value === 1) return "CREATED";
  if (value === 2) return "ACCEPTED";
  if (value === 3) return "SETTLED";
  return "NOT_CREATED";
}

function parseGlobalState(
  appId: number,
  globalState: Array<{
    key: string | Uint8Array;
    value: { type: number; uint?: number | bigint; bytes?: string | Uint8Array };
  }>
): FarmSetuForwardContract {
  const kv = new Map<string, { type: number; uint?: number | bigint; bytes?: string | Uint8Array }>();
  for (const item of globalState) {
    const keyName =
      typeof item.key === "string" ? bytesToString(base64ToBytes(item.key)) : bytesToString(item.key);
    kv.set(keyName, item.value);
  }

  const getUInt = (key: string) => Number(kv.get(key)?.uint ?? 0);
  const getBytes = (key: string) => kv.get(key)?.bytes;

  const bytesToAddress = (key: string) => {
    const raw = getBytes(key);
    if (!raw) return null;
    const addrBytes = typeof raw === "string" ? base64ToBytes(raw) : raw;
    if (addrBytes.length !== 32) return null;
    return algosdk.encodeAddress(asUint8(addrBytes));
  };

  const decodeCrop = () => {
    const raw = getBytes("CN");
    if (!raw) return "";
    const cropBytes = typeof raw === "string" ? base64ToBytes(raw) : raw;
    return textDecoder.decode(cropBytes);
  };

  const buyerAddress = bytesToAddress("BA");
  const buyerIsZero = buyerAddress === algosdk.ALGORAND_ZERO_ADDRESS_STRING;

  return {
    appId,
    farmer_address: bytesToAddress("FA") || "",
    buyer_address: buyerAddress && !buyerIsZero ? buyerAddress : null,
    oracle_address: bytesToAddress("OA") || "",
    crop_name: decodeCrop(),
    quantity: getUInt("Q"),
    agreed_price: microAlgosToAlgo(getUInt("AP")),
    deposited_amount: microAlgosToAlgo(getUInt("DP")),
    current_price: microAlgosToAlgo(getUInt("CP")),
    settlement_amount: microAlgosToAlgo(getUInt("SA")),
    contract_status: appStatusFromNumber(getUInt("ST")),
  };
}

async function fetchContractFromChain(contractId: number): Promise<FarmSetuForwardContract> {
  const app = await algodClient.getApplicationByID(contractId).do();
  const globalState = app.params.globalState || [];
  return parseGlobalState(contractId, globalState);
}

async function createForwardContractOnChain(
  input: CreateContractInput,
  wallet: WalletInstance,
  userAddress: string
): Promise<{ appId: number; txnId: string; confirmedRound?: number }> {
  ensureAddress(userAddress, "User address");
  ensureAddress(input.oracleAddress, "Oracle address");
  const { approvalProgram, clearProgram } = await ensureCompiledPrograms();

  const params = await algodClient.getTransactionParams().do();
  const agreedPriceMicro = algoToMicroAlgos(input.agreedPrice);
  const createTxn = algosdk.makeApplicationCreateTxnFromObject({
    sender: userAddress,
    approvalProgram,
    clearProgram,
    numGlobalInts: 6,
    numGlobalByteSlices: 4,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      textEncoder.encode("create"),
      algosdk.decodeAddress(input.oracleAddress).publicKey,
      textEncoder.encode(input.cropName),
      algosdk.encodeUint64(input.quantity),
      algosdk.encodeUint64(agreedPriceMicro),
    ],
    suggestedParams: params,
  });

  const txId = await sendTransactions(wallet, [{ txn: createTxn }], userAddress);
  const confirmed = await waitConfirmed(txId);
  const appId = Number(confirmed.applicationIndex);
  rememberAppId(appId);

  return { appId, txnId: txId, confirmedRound: toRound(confirmed.confirmedRound) };
}

async function acceptContractOnChain(
  input: AcceptContractInput,
  wallet: WalletInstance,
  userAddress: string
): Promise<{ txnId: string; confirmedRound?: number }> {
  const params = await algodClient.getTransactionParams().do();
  const appAddress = algosdk.getApplicationAddress(input.contractId);

  const depositedMicroAlgos = algoToMicroAlgos(input.depositedAmount);
  const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: userAddress,
    receiver: appAddress,
    amount: depositedMicroAlgos,
    suggestedParams: params,
  });

  const callTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: userAddress,
    appIndex: input.contractId,
    appArgs: [textEncoder.encode("accept")],
    suggestedParams: params,
  });

  algosdk.assignGroupID([paymentTxn, callTxn]);
  const txId = await sendTransactions(wallet, [{ txn: paymentTxn }, { txn: callTxn }], userAddress);
  const confirmed = await waitConfirmed(txId);
  rememberAppId(input.contractId);

  return { txnId: txId, confirmedRound: toRound(confirmed.confirmedRound) };
}

async function updatePriceOnChain(
  input: UpdatePriceInput,
  wallet: WalletInstance,
  userAddress: string
): Promise<{ txnId: string; confirmedRound?: number }> {
  const params = await algodClient.getTransactionParams().do();
  const currentPriceMicro = algoToMicroAlgos(input.currentPrice);
  const callTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: userAddress,
    appIndex: input.contractId,
    appArgs: [textEncoder.encode("update_price"), algosdk.encodeUint64(currentPriceMicro)],
    suggestedParams: params,
  });

  const txId = await sendTransactions(wallet, [{ txn: callTxn }], userAddress);
  const confirmed = await waitConfirmed(txId);
  rememberAppId(input.contractId);

  return { txnId: txId, confirmedRound: toRound(confirmed.confirmedRound) };
}

async function settleContractOnChain(
  input: SettleContractInput,
  wallet: WalletInstance,
  userAddress: string
): Promise<{ txnId: string; settlementAmount: number; confirmedRound?: number }> {
  const params = await algodClient.getTransactionParams().do();
  const settleParams = { ...params, flatFee: true, fee: 2_000 };

  const callTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: userAddress,
    appIndex: input.contractId,
    appArgs: [textEncoder.encode("settle")],
    suggestedParams: settleParams,
  });

  const txId = await sendTransactions(wallet, [{ txn: callTxn }], userAddress);
  const confirmed = await waitConfirmed(txId);

  const updated = await fetchContractFromChain(input.contractId);
  return {
    txnId: txId,
    settlementAmount: updated.settlement_amount,
    confirmedRound: toRound(confirmed.confirmedRound),
  };
}

function readContractsLocal(): FarmSetuForwardContract[] {
  if (!hasWindow()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as FarmSetuForwardContract[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeContractsLocal(contracts: FarmSetuForwardContract[]) {
  if (!hasWindow()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts));
}

function nextContractIdLocal(): number {
  if (!hasWindow()) return Date.now();
  const raw = window.localStorage.getItem(NEXT_ID_KEY);
  const current = raw ? Number(raw) : 10000;
  const next = Number.isFinite(current) ? current + 1 : 10001;
  window.localStorage.setItem(NEXT_ID_KEY, String(next));
  return next;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createForwardContractLocal(
  input: CreateContractInput
): Promise<{ appId: number; txnId: string; confirmedRound?: number }> {
  await sleep(250);

  const appId = nextContractIdLocal();
  const contracts = readContractsLocal();
  const contract: FarmSetuForwardContract = {
    appId,
    farmer_address: input.farmerAddress,
    buyer_address: null,
    oracle_address: input.oracleAddress,
    crop_name: input.cropName,
    quantity: input.quantity,
    agreed_price: input.agreedPrice,
    deposited_amount: 0,
    current_price: input.agreedPrice,
    settlement_amount: 0,
    contract_status: "CREATED",
  };

  writeContractsLocal([contract, ...contracts]);
  return { appId, txnId: `local_create_${Date.now()}` };
}

async function acceptContractLocal(
  input: AcceptContractInput,
  userAddress: string
): Promise<{ txnId: string; confirmedRound?: number }> {
  await sleep(200);
  const contracts = readContractsLocal();
  const idx = contracts.findIndex((c) => c.appId === input.contractId);
  if (idx < 0) throw new Error("Contract not found.");
  if (contracts[idx].contract_status !== "CREATED") {
    throw new Error("Only contracts in CREATED state can be accepted.");
  }

  contracts[idx] = {
    ...contracts[idx],
    buyer_address: userAddress,
    deposited_amount: input.depositedAmount,
    contract_status: "ACCEPTED",
  };
  writeContractsLocal(contracts);

  return { txnId: `local_accept_${Date.now()}` };
}

async function updatePriceLocal(input: UpdatePriceInput): Promise<{ txnId: string; confirmedRound?: number }> {
  await sleep(150);
  const contracts = readContractsLocal();
  const idx = contracts.findIndex((c) => c.appId === input.contractId);
  if (idx < 0) throw new Error("Contract not found.");

  contracts[idx] = { ...contracts[idx], current_price: input.currentPrice };
  writeContractsLocal(contracts);
  return { txnId: `local_update_${Date.now()}` };
}

async function settleContractLocal(
  input: SettleContractInput
): Promise<{ txnId: string; settlementAmount: number; confirmedRound?: number }> {
  await sleep(200);
  const contracts = readContractsLocal();
  const idx = contracts.findIndex((c) => c.appId === input.contractId);
  if (idx < 0) throw new Error("Contract not found.");
  if (contracts[idx].contract_status !== "ACCEPTED") {
    throw new Error("Only accepted contracts can be settled.");
  }

  const contract = contracts[idx];
  const settlementAmount = Math.abs(contract.current_price - contract.agreed_price) * contract.quantity;
  contracts[idx] = {
    ...contract,
    settlement_amount: settlementAmount,
    contract_status: "SETTLED",
  };
  writeContractsLocal(contracts);

  return { txnId: `local_settle_${Date.now()}`, settlementAmount };
}

export async function createForwardContract(
  input: CreateContractInput,
  wallet: WalletInstance,
  userAddress: string
): Promise<{ appId: number; txnId: string; confirmedRound?: number }> {
  if (isOnChainMode()) {
    return createForwardContractOnChain(input, wallet, userAddress);
  }
  return createForwardContractLocal(input);
}

export async function acceptContract(
  input: AcceptContractInput,
  wallet: WalletInstance,
  userAddress: string
): Promise<{ txnId: string; confirmedRound?: number }> {
  if (isOnChainMode()) {
    return acceptContractOnChain(input, wallet, userAddress);
  }
  return acceptContractLocal(input, userAddress);
}

export async function updatePrice(
  input: UpdatePriceInput,
  wallet: WalletInstance,
  userAddress: string
): Promise<{ txnId: string; confirmedRound?: number }> {
  if (isOnChainMode()) {
    return updatePriceOnChain(input, wallet, userAddress);
  }
  return updatePriceLocal(input);
}

export async function settleContract(
  input: SettleContractInput,
  wallet: WalletInstance,
  userAddress: string
): Promise<{ txnId: string; settlementAmount: number; confirmedRound?: number }> {
  if (isOnChainMode()) {
    return settleContractOnChain(input, wallet, userAddress);
  }
  return settleContractLocal(input);
}

export async function getContract(contractId: number): Promise<FarmSetuForwardContract> {
  if (isOnChainMode()) {
    return fetchContractFromChain(contractId);
  }

  await sleep(120);
  const contract = readContractsLocal().find((c) => c.appId === contractId);
  if (!contract) {
    throw new Error(`Contract #${contractId} not found.`);
  }
  return contract;
}

export async function listUserContracts(userAddress: string): Promise<FarmSetuForwardContract[]> {
  if (!isOnChainMode()) {
    await sleep(120);
    return readContractsLocal().sort((a, b) => b.appId - a.appId);
  }

  const ids = readKnownAppIds();
  if (ids.length === 0) return [];

  const contracts = await Promise.all(
    ids.map(async (id) => {
      try {
        return await fetchContractFromChain(id);
      } catch {
        return null;
      }
    })
  );

  const filtered = contracts
    .filter((c): c is FarmSetuForwardContract => c !== null)
    .filter(
      (c) => c.farmer_address === userAddress || c.buyer_address === userAddress || c.contract_status === "CREATED"
    )
    .sort((a, b) => b.appId - a.appId);

  if (filtered.length === 0 && FORWARD_APP_ID > 0) {
    try {
      const app = await fetchContractFromChain(FORWARD_APP_ID);
      return [app];
    } catch {
      return [];
    }
  }

  // Touch indexer once in on-chain mode so misconfigured endpoints fail fast for debugging.
  // We intentionally ignore result data here.
  try {
    await indexerClient.makeHealthCheck().do();
  } catch {
    // no-op
  }

  return filtered;
}
