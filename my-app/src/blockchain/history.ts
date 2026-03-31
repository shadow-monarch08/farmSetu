import algosdk from "algosdk";

export type DepositHistoryItem = {
  txId: string;
  appId: number;
  amountAlgo: number;
  confirmedRound: number;
  timestamp?: number;
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
  };
  "payment-transaction"?: {
    receiver?: string;
    amount?: number;
  };
};

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

    return transactions
      .filter((txn) => txn["tx-type"] === "pay" && txn.sender === address && Boolean(txn.group))
      .map((txn) => {
        const group = txn.group as string;
        const candidateAppIds = appIdsByGroup.get(group) || [];
        const matchedAppId = candidateAppIds.find((candidate) => {
          const expectedAddress = algosdk.getApplicationAddress(candidate).toString();
          return txn["payment-transaction"]?.receiver === expectedAddress;
        });

        if (!matchedAppId) return null;
        if (appId && matchedAppId !== appId) return null;

        return {
          txId: txn.id,
          appId: matchedAppId,
          amountAlgo: Number(txn["payment-transaction"]?.amount ?? 0) / 1_000_000,
          confirmedRound: Number(txn["confirmed-round"] ?? 0),
          timestamp: txn["round-time"],
        } as DepositHistoryItem;
      })
      .filter((item): item is DepositHistoryItem => Boolean(item))
      .sort((a, b) => b.confirmedRound - a.confirmedRound);
  } catch {
    return [];
  }
};