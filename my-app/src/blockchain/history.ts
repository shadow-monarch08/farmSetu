import algosdk from "algosdk";

export type DepositHistoryItem = {
  txId: string;
  appId: number;
  amountAlgo: number;
  confirmedRound: number;
  timestamp?: number;
  type: "deposit" | "withdrawal" | "lock"; // Transaction type
  status?: "pending" | "confirmed";
};

type IndexerTx = {
  id: string;
  sender?: string;
  group?: string;
  "tx-type"?: string;
  "confirmed-round"?: number;
  "round-time"?: number;
  "application-transaction"?: {
    "application-id"?: number;
    "application-args"?: string[];
  };
  "payment-transaction"?: {
    receiver?: string;
    amount?: number;
  };
};

// Helper to decode app args and identify method
function getMethodName(appArgs?: string[]): string | null {
  if (!appArgs || appArgs.length === 0) return null;
  
  // First arg is the method selector (4 bytes)
  const selector = appArgs[0];
  
  // Method selectors (from contract ABI)
  // deposit: 0x26ae6eb8
  // withdraw: 0x59d7c1ba
  // lockIn: 0x47cbf005
  
  const deposits = "JrbuuA=="; // Base64 for 0x26ae6eb8
  const withdraws = "WdfBug=="; // Base64 for 0x59d7c1ba
  const locks = "R8u/AA=="; // Base64 for 0x47cbf005
  
  if (selector === deposits) return "deposit";
  if (selector === withdraws) return "withdrawal";
  if (selector === locks) return "lock";
  
  return null;
}

export const getDepositHistory = async (
  address: string,
  appId?: number
): Promise<DepositHistoryItem[]> => {
  try {
    const response = await fetch(
      `https://testnet-idx.algonode.cloud/v2/accounts/${address}/transactions?limit=200`
    );

    if (!response.ok) return [];

    const payload = (await response.json()) as { transactions?: IndexerTx[] };
    const transactions = payload.transactions || [];

    const result: DepositHistoryItem[] = [];

    // Process deposits (payment txns)
    const appIdsByGroup = new Map<string, number[]>();
    for (const txn of transactions) {
      if (txn["tx-type"] !== "appl") continue;
      const group = txn.group;
      const applicationId = txn["application-transaction"]?.["application-id"];
      if (!group || !applicationId) continue;

      const existing = appIdsByGroup.get(group) || [];
      existing.push(applicationId);
      appIdsByGroup.set(group, existing);
    }

    // Add deposits
    for (const txn of transactions) {
      if (txn["tx-type"] !== "pay" || txn.sender !== address || !txn.group) continue;

      const group = txn.group as string;
      const candidateAppIds = appIdsByGroup.get(group) || [];
      const matchedAppId = candidateAppIds.find((candidate) => {
        const expectedAddress = algosdk.getApplicationAddress(candidate).toString();
        return txn["payment-transaction"]?.receiver === expectedAddress;
      });

      if (!matchedAppId) continue;
      if (appId && matchedAppId !== appId) continue;

      result.push({
        txId: txn.id,
        appId: matchedAppId,
        amountAlgo: Number(txn["payment-transaction"]?.amount ?? 0) / 1_000_000,
        confirmedRound: Number(txn["confirmed-round"] ?? 0),
        timestamp: txn["round-time"],
        type: "deposit",
        status: "confirmed",
      });
    }

    // Add withdrawals and locks (app-only calls from user)
    for (const txn of transactions) {
      if (txn["tx-type"] !== "appl" || txn.sender !== address) continue;

      const applicationId = txn["application-transaction"]?.["application-id"];
      if (!applicationId) continue;

      if (appId && applicationId !== appId) continue;

      const methodName = getMethodName(txn["application-transaction"]?.["application-args"]);
      if (methodName === "deposit") continue; // Skip deposits, already handled
      if (!methodName) continue; // Only handle known methods

      // Extract amount from app args for withdrawals
      let amountAlgo = 0;
      if (methodName === "withdrawal") {
        const appArgs = txn["application-transaction"]?.["application-args"];
        if (appArgs && appArgs.length > 1) {
          try {
            // Second arg is the withdrawal amount (uint64) in base64
            const amountBuffer = new Uint8Array(
              atob(appArgs[1])
                .split("")
                .map((c) => c.charCodeAt(0))
            );
            // Read as big-endian uint64
            if (amountBuffer.length >= 8) {
              const view = new DataView(amountBuffer.buffer);
              amountAlgo = Number(view.getBigUint64(0, false)) / 1_000_000;
            }
          } catch {
            amountAlgo = 0;
          }
        }
      }

      result.push({
        txId: txn.id,
        appId: applicationId,
        amountAlgo,
        confirmedRound: Number(txn["confirmed-round"] ?? 0),
        timestamp: txn["round-time"],
        type: methodName as "deposit" | "withdrawal" | "lock",
        status: "confirmed",
      });
    }

    return result.sort((a, b) => b.confirmedRound - a.confirmedRound);
  } catch {
    return [];
  }
};