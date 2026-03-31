import { getAccountAppLocalState } from "./appLocalState";

export const isOptedIn = async (
  address: string,
  appId: number
): Promise<boolean> => {
  try {
    const appLocalState = await getAccountAppLocalState(address, appId);
    return Boolean(appLocalState);

  } catch (error) {
    console.error("Opt-in check failed:", error);
    return false;
  }
};