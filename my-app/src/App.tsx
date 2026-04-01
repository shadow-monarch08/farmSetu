import { useEffect, useMemo, useRef, useState } from "react";
import algosdk from "algosdk";
import { deployContract } from "./blockchain/deploy";
import { depositAlgo } from "./blockchain/deposit";
import { withdrawAlgo } from "./blockchain/withdraw";
import { lockInAssets } from "./blockchain/lockIn";
import { getSavings } from "./blockchain/read";
import { isOptedIn } from "./blockchain/checkOptin";
import { optInApp } from "./blockchain/optin";
import { getMilestoneThresholds, type Milestone } from "./blockchain/milestones";
import { getDepositHistory, type DepositHistoryItem } from "./blockchain/history";
import { NeonButton } from "./components/NeonButton";
import { ProgressTrack } from "./components/ProgressTrack";
import { AchievementBadge } from "./components/AchievementBadge";
import { WalletStatusPill } from "./components/WalletStatusPill";

type WalletPlatform = "mobile" | "web" | null;

type WalletConnector = {
  on: (event: string, listener: () => void) => void;
};

type WalletInstance = {
  connect: () => Promise<string[]>;
  reconnectSession: () => Promise<string[]>;
  disconnect: () => Promise<void>;
  connector?: WalletConnector | null;
  platform: WalletPlatform;
};

type TierName = "Bronze Saver" | "Silver Saver" | "Gold Saver" | "Diamond Saver";

type Tier = {
  name: TierName;
  threshold: number;
  accent: "teal" | "purple" | "green";
};

type SavingsGoal = {
  id: string;
  name: string;
  amountAlgo: number;
  deadline: string;
  createdAt: number;
};

const CONNECT_MODAL_CLOSED = "CONNECT_MODAL_CLOSED";
const LAST_APP_ID_KEY = "savingsVault:lastAppId";
const HISTORY_CACHE_PREFIX = "fortuna:depositHistory";
const GOALS_STORAGE_PREFIX = "fortuna:goals";
const MILESTONE_LABELS = [
  "Beginner",
  "Starter",
  "Consistent Saver",
  "Bronze Saver",
  "Silver Saver",
  "Gold Saver",
  "Platinum Saver",
  "Diamond Saver",
  "Elite Saver",
  "Vault Master",
];

const TIERS: Tier[] = [
  { name: "Bronze Saver", threshold: 2, accent: "teal" },
  { name: "Silver Saver", threshold: 8, accent: "purple" },
  { name: "Gold Saver", threshold: 15, accent: "green" },
  { name: "Diamond Saver", threshold: 30, accent: "purple" },
];

function toDayStamp(epochSeconds?: number) {
  if (!epochSeconds) return null;
  const day = new Date(epochSeconds * 1000);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function countDailyStreak(items: DepositHistoryItem[]) {
  const uniqueDays = Array.from(
    new Set(items.map((item) => toDayStamp(item.timestamp)).filter((value): value is number => value !== null))
  ).sort((a, b) => b - a);

  if (uniqueDays.length === 0) return 0;

  let streak = 1;
  for (let index = 1; index < uniqueDays.length; index += 1) {
    const previous = uniqueDays[index - 1];
    const current = uniqueDays[index];
    const diffDays = Math.round((previous - current) / 86_400_000);
    if (diffDays === 1) {
      streak += 1;
    } else {
      break;
    }
  }

  return streak;
}

function formatAgo(epochSeconds?: number) {
  if (!epochSeconds) return "Just now";
  const millis = Date.now() - epochSeconds * 1000;
  const minutes = Math.max(1, Math.floor(millis / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getGoalsStorageKey(address: string) {
  return `${GOALS_STORAGE_PREFIX}:${address}`;
}

function getHistoryCacheKey(address: string, appId?: number) {
  return `${HISTORY_CACHE_PREFIX}:${address}:${appId ?? "all"}`;
}

function mergeHistoryItems(
  existing: DepositHistoryItem[],
  incoming: DepositHistoryItem[]
): DepositHistoryItem[] {
  const byId = new Map<string, DepositHistoryItem>();

  for (const item of existing) {
    byId.set(item.txId, item);
  }

  for (const item of incoming) {
    byId.set(item.txId, item);
  }

  return Array.from(byId.values())
    .sort((a, b) => {
      const left = b.confirmedRound - a.confirmedRound;
      if (left !== 0) return left;
      return (b.timestamp ?? 0) - (a.timestamp ?? 0);
    })
    .slice(0, 120);
}

function App() {
  const walletRef = useRef<WalletInstance | null>(null);
  const celebrationTimeoutRef = useRef<number | null>(null);

  const [accountAddress, setAccountAddress] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Loading wallet...");

  const [appId, setAppId] = useState<string | null>(null);
  const [appIdInput, setAppIdInput] = useState("");
  const [amount, setAmount] = useState("");
  const [savings, setSavings] = useState(0);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [depositHistory, setDepositHistory] = useState<DepositHistoryItem[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [showGoalsPanel, setShowGoalsPanel] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [goalDeadline, setGoalDeadline] = useState("");

  const [isOpted, setIsOpted] = useState<boolean | null>(null);
  const [optimisticOptInKey, setOptimisticOptInKey] = useState<string | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [lockDays, setLockDays] = useState("");
  const [lockExpiry, setLockExpiry] = useState<number | null>(null);

  const shortAddress = accountAddress
    ? `${accountAddress.slice(0, 6)}...${accountAddress.slice(-6)}`
    : "Not connected";

  const appAddress = appId ? algosdk.getApplicationAddress(Number(appId)).toString() : null;
  const currentOptInKey = accountAddress && appId ? `${accountAddress}:${appId}` : null;
  const effectiveIsOpted = isOpted === true || optimisticOptInKey === currentOptInKey;
  const isConnected = Boolean(accountAddress);

  const tierInfo = useMemo(() => {
    const achievedIndex = TIERS.reduce((latest, tier, index) => (savings >= tier.threshold ? index : latest), -1);
    const currentTier = achievedIndex >= 0 ? TIERS[achievedIndex] : TIERS[0];
    const nextTier = TIERS[achievedIndex + 1] ?? null;
    const baseThreshold = achievedIndex > 0 ? TIERS[achievedIndex].threshold : 0;
    const topThreshold = nextTier?.threshold ?? currentTier.threshold;
    const progressValue = Math.max(0, savings - baseThreshold);
    const progressMax = Math.max(1, topThreshold - baseThreshold);

    return {
      currentTier,
      nextTier,
      progressValue,
      progressMax,
      unlockedCount: achievedIndex + 1,
    };
  }, [savings]);

  const streakDays = useMemo(() => countDailyStreak(depositHistory), [depositHistory]);

  const achievements = useMemo(
    () => [
      {
        title: "First Deposit",
        description: "Complete your first vault top-up",
        unlocked: depositHistory.length > 0,
      },
      {
        title: "Consistent Saver",
        description: "Save for 3+ consecutive days",
        unlocked: streakDays >= 3,
      },
      {
        title: "Gold Discipline",
        description: "Reach at least 15 ALGO saved",
        unlocked: savings >= 15,
      },
      {
        title: "Milestone Hunter",
        description: "Unlock 3 milestone thresholds",
        unlocked: milestones.filter((item) => item.unlocked).length >= 3,
      },
    ],
    [depositHistory.length, milestones, savings, streakDays]
  );

  function handleDisconnect() {
    const wallet = walletRef.current;
    if (!wallet) return;

    void wallet.disconnect();
    setAccountAddress(null);
    setSavings(0);
    setStatusMessage("Wallet disconnected.");
  }

  async function ensureWallet() {
    if (walletRef.current) return walletRef.current;

    const module = await import("@perawallet/connect");

    const wallet = new module.PeraWalletConnect({
      shouldShowSignTxnToast: false,
    }) as WalletInstance;

    walletRef.current = wallet;
    return wallet;
  }

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        const wallet = await ensureWallet();
        const accounts = await wallet.reconnectSession();

        if (!isMounted) return;

        wallet.connector?.on("disconnect", handleDisconnect);

        if (accounts.length) {
          setAccountAddress(accounts[0]);
          setStatusMessage("Session restored.");
        } else {
          setStatusMessage("Connect wallet to wake the vault.");
        }
      } catch (err) {
        console.error(err);
        setStatusMessage("Wallet init failed.");
      } finally {
        if (isMounted) setIsBusy(false);
      }
    }

    void init();

    return () => {
      isMounted = false;
      if (celebrationTimeoutRef.current) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const savedAppId = localStorage.getItem(LAST_APP_ID_KEY);
    if (savedAppId) {
      setAppId(savedAppId);
      setAppIdInput(savedAppId);
      setStatusMessage("Loaded last App ID.");
    }
  }, []);

  useEffect(() => {
    if (appId) {
      localStorage.setItem(LAST_APP_ID_KEY, appId);
      setAppIdInput(appId);
      return;
    }
    localStorage.removeItem(LAST_APP_ID_KEY);
  }, [appId]);

  useEffect(() => {
    if (!accountAddress) {
      setDepositHistory([]);
      return;
    }

    const cacheKey = getHistoryCacheKey(accountAddress, appId ? Number(appId) : undefined);
    const cached = localStorage.getItem(cacheKey);
    if (!cached) {
      setDepositHistory([]);
      return;
    }

    try {
      const parsed = JSON.parse(cached) as DepositHistoryItem[];
      if (Array.isArray(parsed)) {
        setDepositHistory(parsed);
      }
    } catch {
      setDepositHistory([]);
    }
  }, [accountAddress, appId]);

  useEffect(() => {
    if (!accountAddress) return;
    const cacheKey = getHistoryCacheKey(accountAddress, appId ? Number(appId) : undefined);
    localStorage.setItem(cacheKey, JSON.stringify(depositHistory));
  }, [depositHistory, accountAddress, appId]);

  useEffect(() => {
    if (!accountAddress) {
      setGoals([]);
      return;
    }

    const raw = localStorage.getItem(getGoalsStorageKey(accountAddress));
    if (!raw) {
      setGoals([]);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as SavingsGoal[];
      if (Array.isArray(parsed)) {
        setGoals(parsed);
      } else {
        setGoals([]);
      }
    } catch {
      setGoals([]);
    }
  }, [accountAddress]);

  useEffect(() => {
    if (!accountAddress) return;
    localStorage.setItem(getGoalsStorageKey(accountAddress), JSON.stringify(goals));
  }, [goals, accountAddress]);

  async function handleConnect() {
    setIsBusy(true);

    try {
      const wallet = await ensureWallet();
      const accounts = await wallet.connect();

      wallet.connector?.on("disconnect", handleDisconnect);

      setAccountAddress(accounts[0]);
      setStatusMessage("Wallet linked. Fortuna online.");
    } catch (error) {
      const connectError = error as { data?: { type?: string } };

      if (connectError?.data?.type === CONNECT_MODAL_CLOSED) {
        setStatusMessage("Connection cancelled.");
      } else {
        console.error(error);
        setStatusMessage("Connection failed.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function fetchSavings(targetAppId?: number) {
    const resolvedAppId = targetAppId ?? (appId ? Number(appId) : null);
    if (!accountAddress || !resolvedAppId) return;

    const value = await getSavings(accountAddress, resolvedAppId);
    setSavings(value / 1_000_000);
  }

  async function fetchMilestones(targetAppId?: number) {
    const resolvedAppId = targetAppId ?? (appId ? Number(appId) : null);
    if (!resolvedAppId) return;

    const thresholds = await getMilestoneThresholds(resolvedAppId);
    setMilestones(
      thresholds.map((thresholdAlgo, index) => ({
        label: `${thresholdAlgo} ALGO - ${MILESTONE_LABELS[index] ?? `Level ${index + 1}`}`,
        thresholdAlgo,
        unlocked: savings >= thresholdAlgo,
      }))
    );
  }

  async function fetchDepositHistory(targetAppId?: number) {
    if (!accountAddress) return;

    const resolvedAppId = targetAppId ?? (appId ? Number(appId) : undefined);
    const history = await getDepositHistory(accountAddress, resolvedAppId);
    if (history.length === 0) return;
    setDepositHistory((current) => mergeHistoryItems(current, history));
  }

  async function checkUserOptIn(targetAppId?: number) {
    const resolvedAppId = targetAppId ?? (appId ? Number(appId) : null);
    if (!accountAddress || !resolvedAppId) return;

    const result = await isOptedIn(accountAddress, resolvedAppId);
    if (result) {
      setIsOpted(true);
      setOptimisticOptInKey(`${accountAddress}:${resolvedAppId}`);
      return;
    }

    if (optimisticOptInKey !== `${accountAddress}:${resolvedAppId}`) {
      setIsOpted(false);
    }
  }

  useEffect(() => {
    if (accountAddress) {
      void checkUserOptIn();
      void fetchSavings();
      void fetchDepositHistory();
      void fetchMilestones();
    }
  }, [accountAddress, appId]);

  useEffect(() => {
    if (!appId) return;
    void fetchMilestones(Number(appId));
  }, [savings, appId]);

  async function handleDeploy() {
    if (!accountAddress) return;

    setStatusMessage("Deploying vault contract...");

    const deployedAppId = await deployContract(accountAddress, walletRef.current);

    if (deployedAppId !== null) {
      setAppId(deployedAppId.toString());
      setIsOpted(null);
      setOptimisticOptInKey(null);
      setStatusMessage("Vault deployed successfully.");
      await fetchSavings(deployedAppId);
      await checkUserOptIn(deployedAppId);
      await fetchDepositHistory(deployedAppId);
      await fetchMilestones(deployedAppId);
    } else {
      setStatusMessage("Deployment failed.");
    }
  }

  async function handleUseAppId() {
    await loadAppIdValue(Number(appIdInput.trim()));
  }

  async function loadAppIdValue(appIdValue: number) {
    const parsed = Number(appIdValue);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setStatusMessage("Enter a valid App ID.");
      return;
    }

    setAppId(parsed.toString());
    setAppIdInput(parsed.toString());
    setIsOpted(null);
    setOptimisticOptInKey(null);
    setStatusMessage("App ID loaded. Syncing vault telemetry...");

    await fetchSavings(parsed);
    await checkUserOptIn(parsed);
    await fetchDepositHistory(parsed);
    await fetchMilestones(parsed);
  }

  async function handleDeposit() {
    if (!accountAddress || !appId || !amount) return;

    try {
      const numericAppId = Number(appId);
      let opted = effectiveIsOpted;

      if (!opted) {
        opted = await isOptedIn(accountAddress, numericAppId);
        setIsOpted(opted);
      }

      if (!opted) {
        throw new Error("Account is not opted in yet. Click Opt-In first.");
      }

      setStatusMessage("Processing deposit...");

      const depositResult = await depositAlgo(accountAddress, numericAppId, Number(amount), walletRef.current);

      await fetchSavings(numericAppId);
      await fetchDepositHistory(numericAppId);
      await fetchMilestones(numericAppId);

      setDepositHistory((current) =>
        mergeHistoryItems(current, [
          {
            txId: depositResult.txId,
            appId: numericAppId,
            amountAlgo: Number(amount),
            confirmedRound: depositResult.confirmedRound ?? 0,
            timestamp: Math.floor(Date.now() / 1000),
            type: "deposit",
          },
        ])
      );

      setStatusMessage("Deposit complete! Vault charged.");
      setAmount("");
      setShowCelebration(true);
      if (celebrationTimeoutRef.current) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
      celebrationTimeoutRef.current = window.setTimeout(() => setShowCelebration(false), 1800);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setStatusMessage(`Deposit failed: ${message}`);
    }
  }

  async function handleOptIn() {
    if (!accountAddress || !appId) return;

    try {
      const numericAppId = Number(appId);
      setStatusMessage("Opting in...");

      await optInApp(accountAddress, numericAppId, walletRef.current);

      setIsOpted(true);
      setOptimisticOptInKey(`${accountAddress}:${numericAppId}`);
      setStatusMessage("Opt-in complete! Deposits unlocked.");
      await fetchSavings(numericAppId);
      await fetchDepositHistory(numericAppId);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Opt-in failed.";
      setStatusMessage(`Opt-in failed: ${message}`);
    }
  }

  function handleCreateGoal() {
    const normalizedName = goalName.trim();
    const amountAlgo = Number(goalAmount);

    if (!normalizedName) {
      setStatusMessage("Enter a goal name.");
      return;
    }

    if (!Number.isFinite(amountAlgo) || amountAlgo <= 0) {
      setStatusMessage("Enter a valid goal amount.");
      return;
    }

    if (!goalDeadline) {
      setStatusMessage("Select a goal deadline.");
      return;
    }

    const createdGoal: SavingsGoal = {
      id: crypto.randomUUID(),
      name: normalizedName,
      amountAlgo,
      deadline: goalDeadline,
      createdAt: Date.now(),
    };

    setGoals((current) => [createdGoal, ...current].slice(0, 30));
    setGoalName("");
    setGoalAmount("");
    setGoalDeadline("");
    setStatusMessage("Goal created.");
  }

  function handleDeleteGoal(goalId: string) {
    setGoals((current) => current.filter((goal) => goal.id !== goalId));
    setStatusMessage("Goal removed.");
  }

  async function handleWithdraw() {
    if (!accountAddress || !appId || !withdrawAmount) return;

    try {
      const numericAppId = Number(appId);
      const numericWithdrawAmount = Number(withdrawAmount);
      const pendingTxId = `pending-withdrawal-${crypto.randomUUID()}`;

      setDepositHistory((current) =>
        mergeHistoryItems(current, [
          {
            txId: pendingTxId,
            appId: numericAppId,
            amountAlgo: numericWithdrawAmount,
            confirmedRound: Number.MAX_SAFE_INTEGER,
            timestamp: Math.floor(Date.now() / 1000),
            type: "withdrawal",
            status: "pending",
          },
        ])
      );

      setStatusMessage("Processing withdrawal...");

      await withdrawAlgo(
        accountAddress,
        numericAppId,
        numericWithdrawAmount,
        walletRef.current
      );

      await fetchSavings(numericAppId);
      await fetchDepositHistory(numericAppId);
      await fetchMilestones(numericAppId);
      setDepositHistory((current) => current.filter((item) => item.txId !== pendingTxId));

      setStatusMessage("Withdrawal initiated! Funds reduced from vault.");
      setWithdrawAmount("");
    } catch (err) {
      setDepositHistory((current) => current.filter((item) => !item.txId.startsWith("pending-withdrawal-")));
      console.error(err);
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setStatusMessage(`Withdrawal failed: ${message}`);
    }
  }

  async function handleLockIn() {
    if (!accountAddress || !appId || !lockDays) return;

    try {
      const numericAppId = Number(appId);
      const days = Number(lockDays);

      if (days <= 0) {
        setStatusMessage("Lock duration must be at least 1 day.");
        return;
      }

      setStatusMessage("Locking assets...");

      await lockInAssets(
        accountAddress,
        numericAppId,
        days,
        walletRef.current
      );

      // Set lock expiry for UI display
      const expiryTime = Math.floor(Date.now() / 1000) + days * 86400;
      setLockExpiry(expiryTime);

      setStatusMessage(`Assets locked for ${days} day${days === 1 ? "" : "s"}!`);
      setLockDays("");
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setStatusMessage(`Lock-in failed: ${message}`);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_80%_15%,rgba(168,85,247,0.16),transparent_32%),radial-gradient(circle_at_50%_90%,rgba(45,212,191,0.08),transparent_36%),linear-gradient(160deg,#02030a_0%,#05071a_45%,#030512_100%)]" />

      {showCelebration && (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
          {Array.from({ length: 24 }, (_, index) => (
            <span key={`confetti-${index}`} className="confetti-particle" style={{ left: `${(index / 24) * 100}%` }} />
          ))}
        </div>
      )}

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="glass-panel glow-border relative overflow-hidden rounded-3xl p-6 sm:p-8">
          <div className="absolute -right-12 -top-14 h-40 w-40 rounded-full bg-fuchsia-500/15 blur-3xl" />
          <div className="absolute -left-10 bottom-0 h-36 w-36 rounded-full bg-cyan-400/10 blur-3xl" />

          <div className="relative z-10 flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/85">Fortuna // Savings Vault</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Immersive Savings Command Center</h1>
              </div>
              <WalletStatusPill connected={isConnected} account={shortAddress} />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <article className="rounded-2xl border border-slate-700/60 bg-slate-950/60 p-5">
                <p className="text-xs uppercase tracking-widest text-slate-400">Vault Balance</p>
                <p className="mt-2 text-3xl font-semibold text-cyan-300">{savings.toFixed(6)} ALGO</p>
                <p className="mt-2 text-xs text-slate-400">App ID: {appId ?? "-"}</p>
              </article>

              <article className="rounded-2xl border border-slate-700/60 bg-slate-950/60 p-5">
                <p className="text-xs uppercase tracking-widest text-slate-400">Current Tier</p>
                <p className="mt-2 text-2xl font-semibold text-fuchsia-300">{tierInfo.currentTier.name}</p>
                <p className="mt-2 text-xs text-slate-400">Unlocked tiers: {tierInfo.unlockedCount} / {TIERS.length}</p>
              </article>

              <article className="rounded-2xl border border-slate-700/60 bg-slate-950/60 p-5">
                <p className="text-xs uppercase tracking-widest text-slate-400">Saving Streak</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-300">{streakDays} days</p>
                <p className="mt-2 text-xs text-slate-400">Keep depositing daily to maintain momentum.</p>
              </article>
            </div>

            <ProgressTrack
              label="Vault Energy"
              value={tierInfo.progressValue}
              max={tierInfo.progressMax}
              hue={tierInfo.currentTier.accent}
              helper={
                tierInfo.nextTier
                  ? `${Math.max(0, tierInfo.nextTier.threshold - savings).toFixed(2)} ALGO to ${tierInfo.nextTier.name}`
                  : "Maximum tier achieved"
              }
            />

            <div className="flex flex-wrap gap-3">
              <NeonButton onClick={handleConnect} disabled={isBusy || isConnected}>Connect Wallet</NeonButton>
              <NeonButton variant="secondary" onClick={handleDisconnect} disabled={!isConnected}>Disconnect</NeonButton>
              <NeonButton variant="warning" onClick={handleDeploy} disabled={!isConnected}>Deploy Vault</NeonButton>
            </div>
            <p className="text-sm text-slate-300">{statusMessage}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="glass-panel glow-border rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-white">Deposit Console</h2>
              <NeonButton
                variant={showGoalsPanel ? "warning" : "secondary"}
                className="px-4 py-2 text-xs"
                onClick={() => setShowGoalsPanel((value) => !value)}
              >
                Goals
              </NeonButton>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                type="number"
                min="1"
                placeholder="Existing App ID"
                value={appIdInput}
                onChange={(event) => setAppIdInput(event.target.value)}
              />
              <NeonButton variant="secondary" onClick={handleUseAppId} disabled={!appIdInput.trim()}>
                Load App ID
              </NeonButton>

              <input
                className="rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                type="number"
                min="0"
                step="0.000001"
                placeholder="Deposit amount (ALGO)"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <NeonButton onClick={handleDeposit} disabled={!appId || !amount || !isConnected}>Deposit</NeonButton>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {!effectiveIsOpted && (
                <NeonButton variant="secondary" onClick={handleOptIn} disabled={!appId || !isConnected}>
                  Opt-In to App
                </NeonButton>
              )}
            </div>

            {effectiveIsOpted && (
              <div className="mt-6 space-y-6 border-t border-slate-700 pt-6">
                {/* Withdrawal Section */}
                <div className="rounded-2xl border border-slate-700/60 bg-slate-950/50 p-4">
                  <h3 className="mb-4 text-sm uppercase tracking-[0.2em] text-slate-300">Withdrawal Section</h3>
                  <label className="mb-3 block text-xs uppercase tracking-widest text-slate-400">Withdrawal Amount (ALGO)</label>
                  <input
                    className="mb-3 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
                    type="number"
                    min="0"
                    step="0.000001"
                    placeholder="e.g., 5.5"
                    value={withdrawAmount}
                    onChange={(event) => setWithdrawAmount(event.target.value)}
                  />
                  <NeonButton
                    variant="secondary"
                    className="w-full bg-red-900/30 hover:bg-red-900/50"
                    onClick={handleWithdraw}
                    disabled={!appId || !withdrawAmount || !isConnected}
                  >
                    Withdraw Now
                  </NeonButton>
                </div>

                {/* Lock-In Section */}
                <div className="rounded-2xl border border-slate-700/60 bg-slate-950/50 p-4">
                  <h3 className="mb-4 text-sm uppercase tracking-[0.2em] text-slate-300">Lock Assets Section</h3>
                  <p className="mb-4 text-xs text-slate-400">Requires deposits • Cannot withdraw while locked</p>
                  <label className="mb-3 block text-xs uppercase tracking-widest text-slate-400">Lock Duration (Days)</label>
                  <input
                    className="mb-3 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
                    type="number"
                    min="1"
                    placeholder="e.g., 30"
                    value={lockDays}
                    onChange={(event) => setLockDays(event.target.value)}
                  />
                  <NeonButton
                    variant="warning"
                    className="w-full bg-amber-900/30 hover:bg-amber-900/50"
                    onClick={handleLockIn}
                    disabled={!appId || !lockDays || !isConnected}
                  >
                    Lock Assets Now
                  </NeonButton>
                </div>
              </div>
            )}

            {lockExpiry && (
              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/8 p-4">
                <p className="text-sm text-amber-200">
                  Assets locked until {new Date(lockExpiry * 1000).toLocaleDateString()}
                </p>
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-gradient-to-r from-cyan-500/8 via-blue-500/6 to-fuchsia-500/8 p-4 shadow-[0_0_24px_rgba(34,211,238,0.12)] backdrop-blur-xl">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Vault Link Status</p>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    effectiveIsOpted
                      ? "bg-emerald-400/15 text-emerald-300"
                      : isOpted === null
                        ? "bg-amber-400/15 text-amber-300"
                        : "bg-rose-400/15 text-rose-300"
                  }`}
                >
                  {effectiveIsOpted ? "OPTED IN" : isOpted === null ? "CHECKING" : "NOT OPTED"}
                </span>
              </div>
              <p className="text-sm text-slate-300">
                Wallet to app state: {effectiveIsOpted ? "Ready for deposits" : "Opt-in required"}
              </p>
              <div className="mt-3 rounded-xl border border-slate-700/70 bg-slate-950/70 p-3">
                <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">App Address</p>
                <p className="break-all font-mono text-xs text-cyan-200">{appAddress ?? "-"}</p>
              </div>
            </div>

            {showGoalsPanel && (
              <div className="mt-6 space-y-4 rounded-2xl border border-slate-700/60 bg-slate-950/50 p-4">
                <h3 className="text-sm uppercase tracking-[0.2em] text-slate-300">Goal Tracker</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    className="rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                    type="text"
                    placeholder="Goal name"
                    value={goalName}
                    onChange={(event) => setGoalName(event.target.value)}
                  />
                  <input
                    className="rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                    type="number"
                    min="0"
                    step="0.000001"
                    placeholder="Amount"
                    value={goalAmount}
                    onChange={(event) => setGoalAmount(event.target.value)}
                  />
                  <input
                    className="rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                    type="date"
                    value={goalDeadline}
                    onChange={(event) => setGoalDeadline(event.target.value)}
                  />
                  <NeonButton variant="secondary" onClick={handleCreateGoal}>
                    Create Goal
                  </NeonButton>
                </div>

                <div className="space-y-3">
                  {goals.length === 0 ? (
                    <p className="text-sm text-slate-400">No goals yet. Create your first goal.</p>
                  ) : (
                    goals.map((goal, index) => {
                      const amountLeft = Math.max(0, goal.amountAlgo - savings);
                      return (
                        <article key={goal.id} className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                            <p className="font-medium text-slate-100">{goal.name}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-slate-400">Deadline: {goal.deadline}</p>
                              <NeonButton
                                variant="secondary"
                                className="px-2.5 py-1 text-[11px]"
                                onClick={() => handleDeleteGoal(goal.id)}
                              >
                                Delete
                              </NeonButton>
                            </div>
                          </div>
                          <ProgressTrack
                            label={`${goal.amountAlgo.toFixed(2)} ALGO target`}
                            value={savings}
                            max={goal.amountAlgo}
                            hue={index % 2 === 0 ? "teal" : "purple"}
                            helper={amountLeft === 0 ? "Goal completed from current vault balance." : `${amountLeft.toFixed(2)} ALGO remaining`}
                          />
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <section className="glass-panel glow-border rounded-3xl p-6">
              <h2 className="mb-4 text-xl font-semibold text-white">Achievements</h2>
              <div className="grid gap-3">
                {achievements.map((achievement) => (
                  <AchievementBadge
                    key={achievement.title}
                    title={achievement.title}
                    description={achievement.description}
                    unlocked={achievement.unlocked}
                  />
                ))}
              </div>
            </section>

            <section className="glass-panel glow-border rounded-3xl p-6">
              <h2 className="mb-4 text-xl font-semibold text-white">Tier Ladder</h2>
              <div className="space-y-3">
                {TIERS.map((tier) => {
                  const unlocked = savings >= tier.threshold;
                  return (
                    <article
                      key={tier.name}
                      className={`rounded-xl border px-4 py-3 transition ${
                        unlocked
                          ? "border-emerald-300/40 bg-emerald-400/10 shadow-[0_0_20px_rgba(16,185,129,0.25)]"
                          : "border-slate-700 bg-slate-950/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-slate-100">{tier.name}</p>
                        <p className="text-xs text-slate-400">{tier.threshold.toFixed(2)} ALGO</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        </section>

        <section className="glass-panel glow-border rounded-3xl p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-white">Recent Activity</h2>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest vault transactions</p>
          </div>
          {depositHistory.length === 0 ? (
            <p className="text-sm text-slate-400">No deposits found yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {depositHistory.slice(0, 9).map((item) => {
                const isWithdrawal = item.type === "withdrawal";
                const isLock = item.type === "lock";
                const isPending = item.status === "pending";
                const sign = isWithdrawal ? "-" : "+";
                const amountColor = isWithdrawal ? "text-red-300" : isLock ? "text-amber-300" : "text-cyan-300";
                const typeLabel =
                  isPending && isWithdrawal
                    ? "Withdrawal in process"
                    : item.type === "deposit"
                      ? "Deposit"
                      : item.type === "withdrawal"
                        ? "Withdrawal"
                        : "Lock-In";
                const typeLabelColor = isWithdrawal ? "text-red-400" : isLock ? "text-amber-400" : "text-cyan-400";

                return (
                  <article
                    key={item.txId}
                    className="group rounded-2xl border border-slate-700/80 bg-slate-950/65 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-400/70 hover:shadow-[0_0_24px_rgba(45,212,191,0.2)]"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">{formatAgo(item.timestamp)}</p>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${typeLabelColor} bg-slate-900/50`}>
                        {typeLabel}
                      </span>
                    </div>
                    <p className={`mt-2 text-lg font-semibold ${amountColor}`}>
                      {isLock ? "Lock Applied" : `${sign}${item.amountAlgo.toFixed(6)} ALGO`}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">App ID #{item.appId}</p>
                    <p className="mt-1 text-xs text-slate-500">Round {item.confirmedRound}</p>
                    <button
                      className="mt-3 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-400/70 hover:text-cyan-200"
                      onClick={() => void loadAppIdValue(item.appId)}
                    >
                      Use This App
                    </button>
                    <p className="mt-2 truncate text-[11px] text-slate-500">{item.txId}</p>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
