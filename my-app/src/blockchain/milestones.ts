export type Milestone = {
  label: string;
  thresholdAlgo: number;
  unlocked: boolean;
};

const DEFAULT_THRESHOLDS_ALGO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const decodeBase64Key = (value: string) => {
  try {
    return atob(value);
  } catch {
    return value;
  }
};

export const getMilestoneThresholds = async (appId: number): Promise<number[]> => {
  try {
    const response = await fetch(`https://testnet-api.algonode.cloud/v2/applications/${appId}`);
    if (!response.ok) return DEFAULT_THRESHOLDS_ALGO;

    const payload = (await response.json()) as {
      application?: {
        params?: {
          "global-state"?: Array<{
            key: string;
            value?: { uint?: number | string | bigint };
          }>;
        };
      };
    };

    const globalState = payload.application?.params?.["global-state"] || [];

    const map = new Map<string, number>();
    for (const item of globalState) {
      const key = decodeBase64Key(item.key).toLowerCase();
      const raw = item.value?.uint;
      const micro = typeof raw === "bigint" ? Number(raw) : Number(raw ?? 0);
      if (!Number.isFinite(micro) || micro <= 0) continue;
      map.set(key, micro / 1_000_000);
    }

    const onChain = Array.from({ length: 10 }, (_, idx) => map.get(`milestone${idx + 1}`))
      .filter((value): value is number => typeof value === "number" && value > 0);

    if (onChain.length === 10) return onChain;
    return DEFAULT_THRESHOLDS_ALGO;
  } catch {
    return DEFAULT_THRESHOLDS_ALGO;
  }
};
