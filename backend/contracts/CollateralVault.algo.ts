import { Contract } from '@algorandfoundation/tealscript';

// Define the shape of our Box Storage for each trade's collateral
type PositionRecord = {
  sellerCollateral: uint64;
  buyerCollateral: uint64;
  notional: uint64; // Total value of the contract in USDC micro-units
};

export class CollateralVault extends Contract {
  // Protocol Admin & Factory Links
  admin = GlobalStateKey<Address>();
  factoryAddress = GlobalStateKey<Address>();

  // UPDATE: Use AssetID instead of Asset
  usdcAssetId = GlobalStateKey<AssetID>();

  // BoxMap linking a specific ForwardContract AppID to its Collateral Position
  positions = BoxMap<uint64, PositionRecord>();

  // UPDATE: Use AssetID instead of Asset
  createApplication(usdc: AssetID): void {
    this.admin.value = this.txn.sender;
    this.usdcAssetId.value = usdc;
  }

  // Called by the Admin right after deploying the Factory
  setFactoryAddress(factoryAddr: Address): void {
    assert(this.txn.sender === this.admin.value, "Only admin can set factory address");
    this.factoryAddress.value = factoryAddr;
  }

  // ------------------------------------------------------------------------
  // 1. Authorize Contract (Called by HarvestFactory during M2 creation)
  // ------------------------------------------------------------------------
  authorizeContract(contractId: uint64, notionalAmount: uint64): void {
    assert(
      this.txn.sender === this.admin.value || this.txn.sender === this.factoryAddress.value, 
      "Unauthorized: Only Admin or Factory can authorize"
    );
    
    // Initialize the Box for this specific contract
    this.positions(contractId).value = {
      sellerCollateral: 0,
      buyerCollateral: 0,
      notional: notionalAmount
    };
  }

  // ------------------------------------------------------------------------
  // 2. Deposit Collateral
  // ------------------------------------------------------------------------
  deposit(contractId: uint64, party: string, payment: AssetTransferTxn): void {
    // Verify the position ledger exists
    assert(this.positions(contractId).exists, "Contract ID not authorized in Vault");

    // SECURITY: Verify the payment is strictly USDC and goes directly to this Vault's address
    assert(payment.xferAsset === this.usdcAssetId.value, "Must deposit approved USDC asset");
    assert(payment.assetReceiver === this.app.address, "Payment must be sent to the Vault address");

    // Extract the current record
    const pos = this.positions(contractId).value;

    // Update balances based on who is paying
    if (party === 'SELLER') {
      pos.sellerCollateral += payment.assetAmount;
    } else if (party === 'BUYER') {
      pos.buyerCollateral += payment.assetAmount;
    } else {
      throw Error("Invalid party parameter. Must be 'SELLER' or 'BUYER'");
    }
    
    // Save the updated record back to Box Storage
    this.positions(contractId).value = pos;
  }
}