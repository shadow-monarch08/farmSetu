import algosdk from "algosdk";
import { getAlgodClient } from "./algodClient";

export const depositAlgo = async (
  sender: string,
  appId: number,
  amount: number,
  peraWallet: any
): Promise<{ txId: string; confirmedRound: number | null }> => {
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

    const appAddress = algosdk.getApplicationAddress(appId).toString();
    if (!algosdk.isValidAddress(appAddress)) {
      throw new Error("Invalid App Address");
    }

    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender,
      receiver: appAddress,
      amount: microAlgoAmount,
      suggestedParams: params,
    });

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

    const groupID = algosdk.computeGroupID([paymentTxn, appCallTxn]);
    paymentTxn.group = groupID;
    appCallTxn.group = groupID;

    const txGroup = [
      { txn: paymentTxn, signers: [sender] },
      { txn: appCallTxn, signers: [sender] },
    ];

    const signedTxn = await peraWallet.signTransaction([txGroup]);

    const txResponse = await algodClient.sendRawTransaction(signedTxn).do();
    const confirmation = await algosdk.waitForConfirmation(algodClient, txResponse.txid, 4);

    console.log("Deposit success:", txResponse.txid);

    const confirmedRound = Number(
      (confirmation as unknown as { ["confirmed-round"]?: number })["confirmed-round"] ?? 0
    );

    return {
      txId: txResponse.txid,
      confirmedRound: confirmedRound || null,
    };

  } catch (error) {
    console.error("Deposit failed:", error);
    throw error;
  }
};
