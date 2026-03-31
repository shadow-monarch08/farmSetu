import algosdk from "algosdk";
import { getAlgodClient } from "./algodClient";

export const depositAlgo = async (
  sender: string,
  appId: number,
  amount: number,
  peraWallet: any
) => {
  try {
    if (!Number.isInteger(appId) || appId <= 0) {
      throw new Error("Invalid App ID");
    }

    const algodClient = getAlgodClient();

    const params = await algodClient.getTransactionParams().do();
    const microAlgoAmount = Math.round(amount * 1_000_000);

    if (!Number.isFinite(microAlgoAmount) || microAlgoAmount <= 0) {
      throw new Error("Deposit amount must be greater than 0.");
    }

    const accountInfo = await algodClient.accountInformation(sender).do();
    const balance = Number((accountInfo as any).amount ?? 0);
    const minBalance = Number(
      (accountInfo as any)["min-balance"] ?? (accountInfo as any).minBalance ?? 0
    );
    const spendable = balance - minBalance;
    const estimatedFees = Math.max(Number(params.fee ?? 1000), 1000) * 2;

    if (spendable <= 0) {
      throw new Error(
        `Your account is below minimum balance. Balance: ${(balance / 1_000_000).toFixed(6)} ALGO, minimum required: ${(minBalance / 1_000_000).toFixed(6)} ALGO. Please add ALGO before depositing.`
      );
    }

    if (microAlgoAmount + estimatedFees > spendable) {
      throw new Error(
        `Insufficient spendable balance. Spendable: ${(spendable / 1_000_000).toFixed(6)} ALGO, required: ${((microAlgoAmount + estimatedFees) / 1_000_000).toFixed(6)} ALGO.`
      );
    }
    

    const appAddress = algosdk.getApplicationAddress(appId).toString();
    if (!algosdk.isValidAddress(appAddress)) {
      throw new Error("Invalid App Address");
    }

    console.log("App ID:", appId);

    console.log("App Address:", appAddress);

    // 💰 Txn 1: Payment
    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender,
      receiver: appAddress,
      amount: microAlgoAmount, // ALGO → microAlgos
      suggestedParams: params,
    });
    console.log("Receiver being used (payment txn):", appAddress);

    // 📞 Txn 2: App Call
    const depositMethod = new algosdk.ABIMethod({
      name: "deposit",
      args: [],
      returns: { type: "void" },
    });

    const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender,
      appIndex: appId,
      appArgs: [depositMethod.getSelector()],
      suggestedParams: params,
    });

    // 🔗 GROUP THEM
    const groupID = algosdk.computeGroupID([paymentTxn, appCallTxn]);

    paymentTxn.group = groupID;
    appCallTxn.group = groupID;

    const txGroup = [
      { txn: paymentTxn, signers: [sender] },
      { txn: appCallTxn, signers: [sender] },
    ];

    const signedTxn = await peraWallet.signTransaction([txGroup]);

    const txResponse = await algodClient.sendRawTransaction(signedTxn).do();
    await algosdk.waitForConfirmation(algodClient, txResponse.txid, 4);

    console.log("✅ Deposit success:", txResponse.txid);
    console.log("✅ Payment was sent to app address:", appAddress);

  } catch (error) {
    console.error("Deposit failed:", error);

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("below min")) {
      throw new Error(
        "Your wallet is below minimum required balance for transactions. Please fund the wallet first."
      );
    }

    throw error;
  }

  console.log("App Address:", algosdk.getApplicationAddress(appId));

};