import { useState, useCallback, useEffect } from "react";
import type {
  CreateContractInput,
  AcceptContractInput,
  UpdatePriceInput,
  SettleContractInput,
  FarmSetuForwardContract,
  ContractTransaction,
} from "../types/contract";
import {
  createForwardContract,
  acceptContract,
  updatePrice,
  settleContract,
  getContract,
  listUserContracts,
} from "../services/contractService";
import type { WalletInstance } from "./useWallet";

const TX_STORAGE_KEY = "farmsetu_transactions";

function hasWindow() {
  return typeof window !== "undefined";
}

function txStorageKeyFor(address: string) {
  return `${TX_STORAGE_KEY}:${address}`;
}

function readTransactionsLocal(address: string): ContractTransaction[] {
  if (!hasWindow()) return [];

  const raw = window.localStorage.getItem(txStorageKeyFor(address));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as ContractTransaction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTransactionsLocal(address: string, transactions: ContractTransaction[]) {
  if (!hasWindow()) return;
  window.localStorage.setItem(txStorageKeyFor(address), JSON.stringify(transactions));
}

/**
 * Custom hook for contract management
 * Handles contract operations and transaction tracking
 */
export function useContracts(
  wallet: WalletInstance | null,
  userAddress: string | null
) {
  const [contracts, setContracts] = useState<FarmSetuForwardContract[]>([]);
  const [transactions, setTransactions] = useState<ContractTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userAddress) {
      setTransactions([]);
      return;
    }

    setTransactions(readTransactionsLocal(userAddress));
  }, [userAddress]);

  useEffect(() => {
    if (!userAddress) return;
    writeTransactionsLocal(userAddress, transactions);
  }, [transactions, userAddress]);

  /**
   * Create a new contract
   */
  const create = useCallback(
    async (input: CreateContractInput) => {
      if (!wallet || !userAddress) {
        setError("Wallet not connected");
        return;
      }

      const txId = `txn_${Date.now()}`;
      const transaction: ContractTransaction = {
        id: txId,
        type: "create",
        contractId: 0,
        status: "pending",
        timestamp: Date.now(),
      };

      setTransactions((prev) => [...prev, transaction]);
      setIsLoading(true);
      setError(null);

      try {
        const result = await createForwardContract(input, wallet, userAddress);

        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId
              ? {
                  ...t,
                  status: "success",
                  contractId: result.appId,
                  txnId: result.txnId,
                  confirmedRound: result.confirmedRound,
                }
              : t
          )
        );

        // Add new contract to list
        const newContract = await getContract(result.appId);
        setContracts((prev) => [...prev, newContract]);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId ? { ...t, status: "error", error: errorMsg } : t
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [wallet, userAddress]
  );

  /**
   * Accept a contract
   */
  const accept = useCallback(
    async (input: AcceptContractInput) => {
      if (!wallet || !userAddress) {
        setError("Wallet not connected");
        return;
      }

      const txId = `txn_${Date.now()}`;
      const transaction: ContractTransaction = {
        id: txId,
        type: "accept",
        contractId: input.contractId,
        status: "pending",
        timestamp: Date.now(),
      };

      setTransactions((prev) => [...prev, transaction]);
      setIsLoading(true);
      setError(null);

      try {
        const result = await acceptContract(input, wallet, userAddress);

        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId
              ? { ...t, status: "success", txnId: result.txnId, confirmedRound: result.confirmedRound }
              : t
          )
        );

        // Update contract in list
        const updatedContract = await getContract(input.contractId);
        setContracts((prev) =>
          prev.map((c) => (c.appId === input.contractId ? updatedContract : c))
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId ? { ...t, status: "error", error: errorMsg } : t
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [wallet, userAddress]
  );

  /**
   * Update contract price
   */
  const updateContractPrice = useCallback(
    async (input: UpdatePriceInput) => {
      if (!wallet || !userAddress) {
        setError("Wallet not connected");
        return;
      }

      const txId = `txn_${Date.now()}`;
      const transaction: ContractTransaction = {
        id: txId,
        type: "update_price",
        contractId: input.contractId,
        status: "pending",
        timestamp: Date.now(),
      };

      setTransactions((prev) => [...prev, transaction]);
      setIsLoading(true);
      setError(null);

      try {
        const result = await updatePrice(input, wallet, userAddress);

        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId
              ? { ...t, status: "success", txnId: result.txnId, confirmedRound: result.confirmedRound }
              : t
          )
        );

        // Update contract in list
        const updatedContract = await getContract(input.contractId);
        setContracts((prev) =>
          prev.map((c) => (c.appId === input.contractId ? updatedContract : c))
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId ? { ...t, status: "error", error: errorMsg } : t
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [wallet, userAddress]
  );

  /**
   * Settle a contract
   */
  const settle = useCallback(
    async (input: SettleContractInput) => {
      if (!wallet || !userAddress) {
        setError("Wallet not connected");
        return;
      }

      const txId = `txn_${Date.now()}`;
      const transaction: ContractTransaction = {
        id: txId,
        type: "settle",
        contractId: input.contractId,
        status: "pending",
        timestamp: Date.now(),
      };

      setTransactions((prev) => [...prev, transaction]);
      setIsLoading(true);
      setError(null);

      try {
        const result = await settleContract(input, wallet, userAddress);

        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId
              ? { ...t, status: "success", txnId: result.txnId, confirmedRound: result.confirmedRound }
              : t
          )
        );

        // Update contract in list
        const updatedContract = await getContract(input.contractId);
        setContracts((prev) =>
          prev.map((c) => (c.appId === input.contractId ? updatedContract : c))
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId ? { ...t, status: "error", error: errorMsg } : t
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [wallet, userAddress]
  );

  /**
   * Load contracts for current user
   */
  const loadContracts = useCallback(async () => {
    if (!userAddress) return;

    setIsLoading(true);
    setError(null);

    try {
      const userContracts = await listUserContracts(userAddress);
      setContracts(userContracts);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, [userAddress]);

  return {
    contracts,
    transactions,
    isLoading,
    error,
    create,
    accept,
    updatePrice: updateContractPrice,
    settle,
    loadContracts,
  };
}
