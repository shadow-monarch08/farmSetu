import { useEffect, useMemo, useRef, useState } from "react";
import { deployContract } from "./blockchain/deploy";
import { depositAlgo } from "./blockchain/deposit";
import { withdrawAlgo } from "./blockchain/withdraw";
import { lockInAssets } from "./blockchain/lockIn";
import { getSavings } from "./blockchain/read";
import { isOptedIn } from "./blockchain/checkOptin";
import { optInApp } from "./blockchain/optin";
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

type Tier = {
  name: "Bronze Saver" | "Silver Saver" | "Gold Saver" | "Diamond Saver";
  threshold: number;
  accent: "teal" | "purple" | "green";
};

type ActivityEntry = {
  id: string;
  kind: "deposit" | "deploy";
  amount?: number;
  appId?: string;
  timestamp: number;
};

const CONNECT_MODAL_CLOSED = "CONNECT_MODAL_CLOSED";
const ACTIVITY_STORAGE_KEY = "fortuna:activity";
const HISTORY_CACHE_PREFIX = "fortuna:rootDepositHistory";
const TIERS: Tier[] = [
  { name: "Bronze Saver", threshold: 2, accent: "teal" },
  { name: "Silver Saver", threshold: 8, accent: "purple" },
  { name: "Gold Saver", threshold: 15, accent: "green" },
  { name: "Diamond Saver", threshold: 30, accent: "purple" },
];

const GOALS = [1, 5, 10, 20];

function formatAgo(timestamp: number) {
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.floor(deltaMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
      const roundSort = b.confirmedRound - a.confirmedRound;
      if (roundSort !== 0) return roundSort;
      return (b.timestamp ?? 0) - (a.timestamp ?? 0);
    })
    .slice(0, 120);
}

function toDayStamp(timestamp: number) {
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function countDayStreak(entries: ActivityEntry[]) {
  const uniqueDays = Array.from(
    new Set(
      entries
        .filter((entry) => entry.kind === "deposit")
        .map((entry) => toDayStamp(entry.timestamp))
    )
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

function App() {
  const walletRef = useRef<WalletInstance | null>(null);
  const celebrationTimeoutRef = useRef<number | null>(null);

  const [accountAddress, setAccountAddress] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Loading wallet...");

  const [appId, setAppId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [savings, setSavings] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [depositHistory, setDepositHistory] = useState<DepositHistoryItem[]>([]);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [lockDays, setLockDays] = useState("");
  const [lockExpiry, setLockExpiry] = useState<number | null>(null);

  const shortAddress = accountAddress
    ? `${accountAddress.slice(0, 6)}...${accountAddress.slice(-6)}`
    : "Not connected";

  const isConnected = Boolean(accountAddress);

  const tierInfo = useMemo(() => {
    const achievedIndex = TIERS.reduce((latest, tier, index) => (savings >= tier.threshold ? index : latest), -1);
    const currentTier = achievedIndex >= 0 ? TIERS[achievedIndex] : TIERS[0];
    const nextTier = TIERS[achievedIndex + 1] ?? null;
    const baseThreshold = achievedIndex > 0 ? TIERS[achievedIndex].threshold : 0;
    const topThreshold = nextTier?.threshold ?? currentTier.threshold;

    return {
      currentTier,
      nextTier,
      progressValue: Math.max(0, savings - baseThreshold),
      progressMax: Math.max(1, topThreshold - baseThreshold),
      unlockedCount: achievedIndex + 1,
    };
  }, [savings]);

  const streakDays = useMemo(() => countDayStreak(activity), [activity]);

  const achievements = useMemo(
    () => [
      {
        title: "First Deposit",
        description: "Complete your first vault top-up",
        unlocked: activity.some((entry) => entry.kind === "deposit"),
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
        title: "Vault Engineer",
        description: "Deploy at least one vault",
        unlocked: activity.some((entry) => entry.kind === "deploy"),
      },
    ],
    [activity, savings, streakDays]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ActivityEntry[];
      if (Array.isArray(parsed)) {
        setActivity(parsed.filter((item) => item && typeof item.timestamp === "number"));
      }
    } catch {
      setActivity([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activity.slice(0, 100)));
  }, [activity]);

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

  async function fetchSavings() {
    if (!accountAddress || !appId) return;

    const value = await getSavings(accountAddress, Number(appId));
    setSavings(value / 1_000_000);
  }

  async function fetchDepositHistory(targetAppId?: number) {
    if (!accountAddress) return;

    const resolvedAppId = targetAppId ?? (appId ? Number(appId) : undefined);
    const history = await getDepositHistory(accountAddress, resolvedAppId);
    if (history.length === 0) return;
    setDepositHistory((current) => mergeHistoryItems(current, history));
  }

  async function handleRefreshBalance() {
    if (!accountAddress || !appId) {
      setStatusMessage("Connect wallet and deploy/load an App ID first.");
      return;
    }

    setStatusMessage("Refreshing vault balance...");
    await fetchSavings();
    setStatusMessage("Vault balance refreshed.");
  }

  useEffect(() => {
    void fetchSavings();
    void fetchDepositHistory();
  }, [accountAddress, appId]);

  async function handleDeploy() {
    if (!accountAddress) return;

    setStatusMessage("Deploying vault contract...");

    const deployedAppId = await deployContract(accountAddress, walletRef.current);

    if (deployedAppId !== null) {
      const deployedString = deployedAppId.toString();
      setAppId(deployedString);
      setStatusMessage("Vault deployed successfully.");
      setActivity((current) => [
        {
          id: crypto.randomUUID(),
          kind: "deploy",
          appId: deployedString,
          timestamp: Date.now(),
        },
        ...current,
      ]);
      await fetchSavings();
      await fetchDepositHistory(deployedAppId);
    } else {
      setStatusMessage("Deployment failed.");
    }
  }

  async function handleDeposit() {
    if (!accountAddress || !appId || !amount) return;

    try {
      const numericAppId = Number(appId);
      const numericAmount = Number(amount);

      let optedIn = await isOptedIn(accountAddress, numericAppId);

      if (!optedIn) {
        setStatusMessage("Opting in...");
        await optInApp(accountAddress, numericAppId, walletRef.current);
        optedIn = true;
      }

      if (!optedIn) {
        setStatusMessage("Opt-in required.");
        return;
      }

      setStatusMessage("Processing deposit...");

      const depositResult = await depositAlgo(accountAddress, numericAppId, numericAmount, walletRef.current);

      await fetchSavings();
      await fetchDepositHistory(numericAppId);

      setDepositHistory((current) =>
        mergeHistoryItems(current, [
          {
            txId: depositResult.txId,
            appId: numericAppId,
            amountAlgo: numericAmount,
            confirmedRound: depositResult.confirmedRound ?? 0,
            timestamp: Math.floor(Date.now() / 1000),
            type: "deposit",
          },
        ])
      );

      setActivity((current) => [
        {
          id: crypto.randomUUID(),
          kind: "deposit",
          amount: numericAmount,
          appId,
          timestamp: Date.now(),
        },
        ...current,
      ]);

      setStatusMessage("Deposit complete! Vault charged.");
      setAmount("");
      setShowCelebration(true);

      if (celebrationTimeoutRef.current) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
      celebrationTimeoutRef.current = window.setTimeout(() => setShowCelebration(false), 1800);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deposit failed.";
      setStatusMessage(`Deposit failed: ${message}`);
    }
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

      await fetchSavings();
      await fetchDepositHistory(numericAppId);
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
                <p className="mt-2 text-xs text-slate-400">Consecutive days with at least one deposit.</p>
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
              <NeonButton variant="secondary" onClick={handleRefreshBalance}>Refresh Balance</NeonButton>
            </div>
            <p className="text-sm text-slate-300">{statusMessage}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="glass-panel glow-border rounded-3xl p-6">
            <h2 className="mb-4 text-xl font-semibold text-white">Deposit Console</h2>
            <div className="grid gap-3 sm:grid-cols-2">
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

            {lockExpiry && (
              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/8 p-4">
                <p className="text-sm text-amber-200">
                  Assets locked until {new Date(lockExpiry * 1000).toLocaleDateString()}
                </p>
              </div>
            )}

            <h3 className="mb-3 mt-6 text-sm uppercase tracking-[0.2em] text-slate-400">Savings Goals</h3>
            <div className="space-y-3">
              {GOALS.map((goal, index) => (
                <ProgressTrack
                  key={goal}
                  label={`${goal} ALGO Goal`}
                  value={savings}
                  max={goal}
                  hue={index % 2 === 0 ? "teal" : "purple"}
                  helper={savings >= goal ? "Goal unlocked" : `${(goal - savings).toFixed(2)} ALGO remaining`}
                />
              ))}
            </div>
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
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest vault events</p>
          </div>
          {activity.length === 0 && depositHistory.length === 0 ? (
            <p className="text-sm text-slate-400">No activity yet. Deploy or deposit to populate timeline.</p>
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
                      <p className="text-xs text-slate-500">{formatAgo((item.timestamp ?? Math.floor(Date.now() / 1000)) * 1000)}</p>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${typeLabelColor} bg-slate-900/50`}>
                        {typeLabel}
                      </span>
                    </div>
                    <p className={`mt-2 text-lg font-semibold ${amountColor}`}>
                      {isLock ? "Lock Applied" : `${sign}${item.amountAlgo.toFixed(6)} ALGO`}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">App ID #{item.appId}</p>
                    <p className="mt-1 text-xs text-slate-500">Round {item.confirmedRound}</p>
                    <p className="mt-2 truncate text-[11px] text-slate-500">{item.txId}</p>
                  </article>
                );
              })}

              {activity.slice(0, 9).map((entry) => (
                <article
                  key={entry.id}
                  className="group rounded-2xl border border-slate-700/80 bg-slate-950/65 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-400/70 hover:shadow-[0_0_24px_rgba(45,212,191,0.2)]"
                >
                  <p className="text-xs text-slate-500">{formatAgo(entry.timestamp)}</p>
                  <p className="mt-2 text-lg font-semibold text-cyan-300">
                    {entry.kind === "deposit" ? `+${entry.amount?.toFixed(6)} ALGO` : "Vault Deployed"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{entry.appId ? `App ID #${entry.appId}` : ""}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
