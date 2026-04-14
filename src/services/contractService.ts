import algosdk, { base64ToBytes, bytesToString } from "algosdk";
import type {
  CreateContractInput,
  AcceptContractInput,
  UpdatePriceInput,
  SettleContractInput,
  FarmSetuForwardContract,
} from "../types/contract";
import type { WalletInstance } from "../hooks/useWallet";
import { algodClient, FORWARD_APP_ID, indexerClient, isOnChainMode, ORACLE_ADDRESS } from "./networkConfig";
import { FORWARD_APPROVAL_TEAL, FORWARD_CLEAR_TEAL } from "./tealSources";
import { algoToMicroAlgos, microAlgosToAlgo } from "../utils/units";

const STORAGE_KEY = "farmsetu_contracts";
const NEXT_ID_KEY = "farmsetu_next_contract_id";
const KNOWN_APP_IDS_KEY = "farmsetu_known_app_ids";
const ADDRESS_REGEX = /^[A-Z2-7]{58}$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const FACTORY_APP_ID = Number(import.meta.env.VITE_FACTORY_APP_ID || 1007);

type SignerTransaction = { txn: algosdk.Transaction; signers?: string[]; authAddr?: string };

let compiledApprovalProgram: Uint8Array | null = null;
let compiledClearProgram: Uint8Array | null = null;

function hasWindow() {
  return typeof window !== "undefined";
}

function asUint8(value: Uint8Array | number[]) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function decodeStateKey(key: string | Uint8Array): string {
  if (key instanceof Uint8Array) {
    return bytesToString(key);
  }

  try {
    return bytesToString(base64ToBytes(key));
  } catch {
    // Some SDK/indexer responses can already contain plain keys.
    return key;
  }
}

function decodeMaybeBase64(value: string | Uint8Array): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }

  try {
    return base64ToBytes(value);
  } catch {
    try {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      return base64ToBytes(padded);
    } catch {
      return null;
    }
  }
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
  const normalizedTxns = txns.map((entry) => ({
    ...entry,
    signers: entry.signers ?? (signerAddress ? [signerAddress] : undefined),
  }));
  const signedResponse = await wallet.signTransaction([normalizedTxns]);

  // Pera can return signed payloads with nullable entries; remove empties defensively.
  const signed = (Array.isArray(signedResponse) ? signedResponse : [])
    .flatMap((item) => (item instanceof Uint8Array ? [item] : []))
    .filter((blob) => blob.byteLength > 0);

  if (signed.length === 0) {
    throw new Error(
      "Wallet returned no signed transactions. Please reconnect wallet and approve the signature request."
    );
  }

  const payload = signed.length === 1 ? signed[0] : signed;
  const result = await algodClient.sendRawTransaction(payload).do();
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
    const keyName = decodeStateKey(item.key);
    kv.set(keyName, item.value);
  }

  const getUInt = (key: string) => Number(kv.get(key)?.uint ?? 0);
  const getBytes = (key: string) => kv.get(key)?.bytes;

  const bytesToAddress = (key: string) => {
    const raw = getBytes(key);
    if (!raw) return null;
    const addrBytes = decodeMaybeBase64(raw);
    if (!addrBytes) return null;
    if (addrBytes.length !== 32) return null;
    return algosdk.encodeAddress(asUint8(addrBytes));
  };

  const decodeCrop = () => {
    const raw = getBytes("CN");
    if (!raw) return "";
    const cropBytes = decodeMaybeBase64(raw);
    if (!cropBytes) return "";
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
  const { approvalProgram, clearProgram } = await ensureCompiledPrograms();

  const params = await algodClient.getTransactionParams().do();
  const agreedPriceMicro = algoToMicroAlgos(input.agreedPrice);
  
  // 1. Deploy the Forward Contract
  const createTxn = algosdk.makeApplicationCreateTxnFromObject({
    sender: userAddress,
    approvalProgram,
    clearProgram,
    numGlobalInts: 7,
    numGlobalByteSlices: 4,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      textEncoder.encode("create"),
      algosdk.decodeAddress(ORACLE_ADDRESS).publicKey,
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

  // 2. Factory Registration (ABI Encoded)
  // Maps directly to TEALScript: registerTrade(contractId: uint64, seller: Address)
  const registerMethod = algosdk.ABIMethod.fromSignature("registerTrade(uint64,address)void");
  
  const factoryTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: userAddress,
    appIndex: FACTORY_APP_ID,
    appArgs: [
      registerMethod.getSelector(),
      algosdk.encodeUint64(appId),                     // FIX: Bypass ABI generic, use native uint64 encoder
      algosdk.decodeAddress(userAddress).publicKey     // FIX: Bypass ABI generic, use native address decoder
    ],
    // Box reference required for the Factory's BoxMap storage
    boxes: [
      { appIndex: FACTORY_APP_ID, name: algosdk.encodeUint64(appId) }
    ],
    suggestedParams: params,
  });

  // Execute factory registration as a best-effort step for hackathon compatibility.
  // If factory is not deployed, the contract app is still valid and usable by APP_ID.
  try {
    await sendTransactions(wallet, [{ txn: factoryTxn }], userAddress);
  } catch (error) {
    console.warn("Factory registration skipped:", error);
  }

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
  const contract = await fetchContractFromChain(input.contractId);
  const appAddress = algosdk.getApplicationAddress(input.contractId);
  const [app, appAccount] = await Promise.all([
    algodClient.getApplicationByID(input.contractId).do(),
    algodClient.accountInformation(appAddress).do(),
  ]);

  const appGlobalState = app.params.globalState || [];
  const depositedAmountRaw = appGlobalState.find((entry: { key: string }) => {
    const keyName = decodeStateKey(entry.key);
    return keyName === "DP";
  })?.value?.uint;

  const depositedMicroAlgos =
    typeof depositedAmountRaw === "bigint"
      ? Number(depositedAmountRaw)
      : typeof depositedAmountRaw === "number"
      ? depositedAmountRaw
      : 0;

  const escrowBalance = Number(appAccount.amount || 0);
  const minAccountBalance = 100_000;
  const projectedBalanceAfterSettle = escrowBalance - depositedMicroAlgos;
  const topUpAmount = Math.max(0, minAccountBalance - projectedBalanceAfterSettle);

  const params = await algodClient.getTransactionParams().do();
  const settleParams = { ...params, flatFee: true, fee: 2_000 };

  // Inner transactions use FA/BA from global state as receivers; include them as available accounts.
  const accounts = Array.from(
    new Set(
      [contract.farmer_address, contract.buyer_address]
        .filter((address): address is string => !!address)
        .filter((address) => address !== algosdk.ALGORAND_ZERO_ADDRESS_STRING)
    )
  );

  const callTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: userAddress,
    appIndex: input.contractId,
    appArgs: [textEncoder.encode("settle")],
    accounts,
    suggestedParams: settleParams,
  });

  const txns: SignerTransaction[] = [];
  if (topUpAmount > 0) {
    const topUpTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: userAddress,
      receiver: appAddress,
      amount: topUpAmount,
      suggestedParams: params,
    });
    txns.push({ txn: topUpTxn });
  }

  txns.push({ txn: callTxn });
  if (txns.length > 1) {
    algosdk.assignGroupID(txns.map((entry) => entry.txn));
  }

  const txId = await sendTransactions(wallet, txns, userAddress);
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
    oracle_address: ORACLE_ADDRESS,
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
