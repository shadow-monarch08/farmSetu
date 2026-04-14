import { Contract } from '@algorandfoundation/tealscript';

export class FarmSetuFactory extends Contract {
  admin = GlobalStateKey<Address>();
  
  // UPDATE: Use AppID instead of Application
  vaultAppId = GlobalStateKey<AppID>();

  // Box storage tracking all official protocol contracts
  // Key: ForwardContract App ID (uint64)
  // Value: Seller's Address 
  officialTrades = BoxMap<uint64, Address>();
  
  // Total count of trades for UI statistics
  totalTrades = GlobalStateKey<uint64>();

  createApplication(): void {
    this.admin.value = this.txn.sender;
    this.totalTrades.value = 0;
  }

  // 1. Link the Vault
  // UPDATE: Use AppID instead of Application
  setVault(vaultId: AppID): void {
    assert(this.txn.sender === this.admin.value, "Only admin can set the Vault");
    this.vaultAppId.value = vaultId;
  }

  // 2. Register a New Trade
  registerTrade(contractId: uint64, seller: Address): void {
    // Prevent duplicate registrations
    assert(!this.officialTrades(contractId).exists, "Trade is already registered");

    // Store the contract ID as an official FarmSetu market
    this.officialTrades(contractId).value = seller;
    
    // Increment our platform statistics
    this.totalTrades.value = this.totalTrades.value + 1;
  }
}