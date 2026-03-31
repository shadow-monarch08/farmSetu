export type AppLocalState = {
  id: number;
  "key-value"?: Array<{
    key: string;
    value: {
      type: number;
      bytes?: string;
      uint?: number | string | bigint;
    };
  }>;
};

export const getAccountAppLocalState = async (
  address: string,
  appId: number
): Promise<AppLocalState | null> => {
  const response = await fetch(
    `https://testnet-api.algonode.cloud/v2/accounts/${address}/applications/${appId}`
  );

  if (!response.ok) {
    if (response.status === 404) return null;
    const body = await response.text();
    throw new Error(`Failed to fetch app local state: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as { "app-local-state"?: AppLocalState };
  return payload["app-local-state"] ?? null;
};
