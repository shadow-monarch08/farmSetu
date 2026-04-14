import { Contract } from '@algorandfoundation/tealscript';

// Status Enums
const STATUS_INITIALIZED = 0;
const STATUS_ACTIVE = 1;
const STATUS_SETTLED = 2;
const STATUS_LIQUIDATED = 3;

export class ForwardContract extends Contract {
  // Contract Identity & Links
  registryAppId = GlobalStateKey<uint64>();
  commodityCode = GlobalStateKey<string>();
  
  // Counterparties
  seller = GlobalStateKey<Address>();
  buyer = GlobalStateKey<Address>();
  sellerFunded = GlobalStateKey<boolean>();
  buyerFunded = GlobalStateKey<boolean>();
  
  // Economics
  lotQuantity = GlobalStateKey<uint64>();
  strikePricePaise = GlobalStateKey<uint64>(); // ₹/quintal * 100
  totalNotionalUSDC = GlobalStateKey<uint64>(); // Scaled micro-USDC
  
  // Timeline
  expiryTs = GlobalStateKey<uint64>();
  status = GlobalStateKey<uint64>();

  createApplication(
    registryId: uint64,
    code: string,
    sellerAddr: Address,
    buyerAddr: Address,
    lots: uint64,
    strikePrice: uint64,
    expiry: uint64
  ): void {
    // Input Validation
    assert(lots > 0, "Minimum 1 lot required");
    assert(globals.latestTimestamp < expiry, "Expiry must be in the future");
    assert(sellerAddr !== buyerAddr, "Buyer and Seller cannot be identical");

    // Initialize State
    this.registryAppId.value = registryId;
    this.commodityCode.value = code;
    this.seller.value = sellerAddr;
    this.buyer.value = buyerAddr;
    
    this.lotQuantity.value = lots;
    this.strikePricePaise.value = strikePrice;
    
    // lotSize = 10 quintals (hardcoded for v1, normally fetched from Registry)
    // Notional calculation: lots * 10 * strikePrice
    this.totalNotionalUSDC.value = lots * 10 * strikePrice;
    
    this.expiryTs.value = expiry;
    this.status.value = STATUS_INITIALIZED;
    this.sellerFunded.value = false;
    this.buyerFunded.value = false;
  }

  // Called by CollateralVault (M3) when funds hit the escrow
  confirmFunding(party: string): void {
    assert(this.status.value === STATUS_INITIALIZED, "Contract already active or settled");
    
    // Ensure only the designated Collateral Vault can trigger this in production
    // (We will add strict caller verification when we build M3)

    if (party === 'SELLER') {
      this.sellerFunded.value = true;
    } else if (party === 'BUYER') {
      this.buyerFunded.value = true;
    } else {
      throw Error("Invalid party parameter");
    }

    // State Transition
    if (this.sellerFunded.value && this.buyerFunded.value) {
      this.status.value = STATUS_ACTIVE;
    }
  }
}