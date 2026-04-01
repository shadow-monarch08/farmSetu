import algosdk from "algosdk";
import { getAlgodClient } from "./algodClient";
import { getAccountAppLocalState } from "./appLocalState";

export const optInApp = async (
  sender: string,
  appId: number,
  peraWallet: any
) => {
  try {
    const algodClient = getAlgodClient();
    const optInMethod = new algosdk.ABIMethod({
      name: "optIn",
      args: [],
      returns: { type: "void" },
    });

    const appState = await getAccountAppLocalState(sender, appId);
    const isAlreadyOptedIn = Boolean(appState);

    if (!isAlreadyOptedIn) {
      const params = await algodClient.getTransactionParams().do();

      const txn = algosdk.makeApplicationOptInTxnFromObject({
        sender,
        appIndex: appId,
        appArgs: [optInMethod.getSelector()],
        suggestedParams: params,
      });

      try {
        const txGroup = [{ txn, signers: [sender] }];
        const signedTxn = await peraWallet.signTransaction([txGroup]);
        const optInResponse = await algodClient.sendRawTransaction(signedTxn).do();
        await algosdk.waitForConfirmation(algodClient, optInResponse.txid, 4);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("already opted in")) {
          throw error;
        }
      }
    }

    const refreshedAppState = await getAccountAppLocalState(sender, appId);
    const keyValue = (refreshedAppState as any)?.["key-value"] || [];
    const hasTotalSaved = keyValue.some((item: any) => atob(item.key) === "totalSaved");

    if (hasTotalSaved) {
      console.log("Account already initialized for savings state");
      return;
    }

    const initTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender,
      appIndex: appId,
      appArgs: [optInMethod.getSelector()],
      suggestedParams: await algodClient.getTransactionParams().do(),
    });

    const initGroup = [{ txn: initTxn, signers: [sender] }];
    const signedInitTxn = await peraWallet.signTransaction([initGroup]);
    const initResponse = await algodClient.sendRawTransaction(signedInitTxn).do();
    await algosdk.waitForConfirmation(algodClient, initResponse.txid, 4);

    console.log("Opt-in successful");

  } catch (error) {
    console.error("Opt-in failed:", error);
    throw error;
  }
};