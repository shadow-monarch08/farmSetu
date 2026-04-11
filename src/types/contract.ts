/**
 * FarmSetu Contract Types
 * Adapted from FarmSetu backend for TypeScript/React
 */

export type ContractStatus = "NOT_CREATED" | "CREATED" | "ACCEPTED" | "SETTLED";

export interface FarmSetuForwardContract {
  appId: number;
  farmer_address: string;
  buyer_address: string | null;
  oracle_address: string;
  crop_name: string;
  quantity: number;
  agreed_price: number;
  deposited_amount: number;
  current_price: number;
  settlement_amount: number;
  contract_status: ContractStatus;
}

export interface CreateContractInput {
  farmerAddress: string;
  oracleAddress: string;
  cropName: string;
  quantity: number;
  agreedPrice: number;
}

export interface AcceptContractInput {
  contractId: number;
  buyerAddress: string;
  depositedAmount: number;
}

export interface UpdatePriceInput {
  contractId: number;
  currentPrice: number;
}

export interface SettleContractInput {
  contractId: number;
}

export interface ContractList {
  contracts: FarmSetuForwardContract[];
  totalCount: number;
}

export interface ContractTransaction {
  id: string;
  type: "create" | "accept" | "update_price" | "settle";
  contractId: number;
  txnId?: string;
  confirmedRound?: number;
  status: "pending" | "success" | "error";
  error?: string;
  timestamp: number;
}
