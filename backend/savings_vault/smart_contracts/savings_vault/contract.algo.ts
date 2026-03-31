import { Contract, abimethod } from '@algorandfoundation/algorand-typescript'
import { Global, LocalState, Txn, Uint64, assert, gtxn, type uint64 } from '@algorandfoundation/algorand-typescript'

export class SavingsVault extends Contract {

  // ✅ Define local state
  totalSaved = LocalState<uint64>()

  // ✅ Opt-in
  @abimethod({ allowActions: ['OptIn', 'NoOp'] })
  optIn(): void {
    this.totalSaved(Txn.sender).value = Uint64(0)
  }

  // 💰 Deposit
  deposit(): void {

    // Get previous transaction (payment)
    const paymentTxn = gtxn.PaymentTxn(Txn.groupIndex - 1)

    // Validate payment
    assert(paymentTxn.amount > 0)
    assert(paymentTxn.receiver === Global.currentApplicationAddress)

    // Update savings
    const current = this.totalSaved(Txn.sender).value
    this.totalSaved(Txn.sender).value = current + paymentTxn.amount
  }
}