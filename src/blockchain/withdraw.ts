import algosdk from "algosdk";
import { getAlgodClient } from "./algodClient";

export const withdrawAlgo = async (
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
      throw new Error("Withdrawal amount must be greater than 0.");
    }

    // 📞 App Call: Withdraw
    const withdrawMethod = new algosdk.ABIMethod({
      name: "withdraw",
      args: [{ type: "uint64" }],
      returns: { type: "void" },
    });

    const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender,
      appIndex: appId,
      appArgs: [
        withdrawMethod.getSelector(),
        algosdk.encodeUint64(microAlgoAmount),
      ],
      suggestedParams: params,
    });

    const txGroup = [
      { txn: appCallTxn, signers: [sender] },
    ];

    const signedTxn = await peraWallet.signTransaction([txGroup]);

    const txResponse = await algodClient.sendRawTransaction(signedTxn).do();
    const confirmation = await algosdk.waitForConfirmation(algodClient, txResponse.txid, 4);

    console.log("Withdrawal initiated:", txResponse.txid);

    const confirmedRound = Number(
      (confirmation as unknown as { ["confirmed-round"]?: number })["confirmed-round"] ?? 0
    );

    return {
      txId: txResponse.txid,
      confirmedRound: confirmedRound || null,
    };
  } catch (error) {
    console.error("Withdrawal failed:", error);

    const message = error instanceof Error ? error.message : String(error);
    
    // Provide helpful context for common errors
    if (message.includes("err opcode")) {
      throw new Error("Withdrawal failed: Assets are locked or you don't have enough to withdraw.");
    }
    if (message.includes("logic eval error")) {
      throw new Error("Withdrawal failed: Check if assets are locked and try again.");
    }
    if (message.includes("no funds")) {
      throw new Error("Withdrawal failed: Insufficient balance. Check your vault savings.");
    }

    throw error;
  }
};
