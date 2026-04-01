import algosdk from "algosdk";
import { getAlgodClient } from "./algodClient";

export const deployContract = async (
  sender: string,
  peraWallet: any
): Promise<number | null> => {
  try {
    if (!sender || !peraWallet) {
      throw new Error("Wallet not connected properly");
    }

    const algodClient = getAlgodClient();

    // 🔥 FETCH TEAL
    const approvalSource = await fetch("/approval.teal").then((res) =>
      res.text()
    );
    const clearSource = await fetch("/clear.teal").then((res) =>
      res.text()
    );

    // 🔥 COMPILE
    const compiledApproval = await algodClient.compile(approvalSource).do();
    const compiledClear = await algodClient.compile(clearSource).do();

    const approvalProgram = new Uint8Array(
      Uint8Array.from(atob(compiledApproval.result), (c) =>
        c.charCodeAt(0)
      )
    );

    const clearProgram = new Uint8Array(
      Uint8Array.from(atob(compiledClear.result), (c) =>
        c.charCodeAt(0)
      )
    );

    const params = await algodClient.getTransactionParams().do();

    const txn = algosdk.makeApplicationCreateTxnFromObject({
      sender: sender,
      suggestedParams: params,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      approvalProgram,
      clearProgram,
      numGlobalInts: 3,
      numGlobalByteSlices: 0,
      numLocalInts: 2,
      numLocalByteSlices: 0,
    });

    const txGroup = [{ txn, signers: [sender] }];

    const signedTxn = await peraWallet.signTransaction([txGroup]);

    const txResponse = await algodClient.sendRawTransaction(signedTxn).do();
    const confirmedTxn = await algosdk.waitForConfirmation(
      algodClient,
      txResponse.txid,
      4
    );

    const appId = confirmedTxn.applicationIndex;

    if (!appId) {
      console.error("App ID missing");
      return null;
    }

    console.log("✅ App ID:", appId);

    return Number(appId);

  } catch (error: any) {
    console.error("Deployment failed:", error);
    alert(error?.message || "Deployment failed");
    return null;
  }
};