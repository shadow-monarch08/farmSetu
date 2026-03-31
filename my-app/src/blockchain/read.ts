import { getAccountAppLocalState } from "./appLocalState";

export const getSavings = async (
  address: string,
  appId: number
): Promise<number> => {
  try {
    const appLocalState = await getAccountAppLocalState(address, appId);
    const keyValue = appLocalState?.["key-value"] || [];

    for (const item of keyValue) {
      const isTotalSavedKey =
        item.key === "dG90YWxTYXZlZA==" ||
        item.key === "totalSaved";

      if (isTotalSavedKey) {
        const uintValue = item?.value?.uint;

        if (typeof uintValue === "bigint") return Number(uintValue);
        if (typeof uintValue === "number") return uintValue;
        if (typeof uintValue === "string") return Number(uintValue) || 0;

        return 0;
      }
    }

    return 0;

  } catch (error) {
    console.error("Error fetching savings:", error);
    return 0;
  }
};