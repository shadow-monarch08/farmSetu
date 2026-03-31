import { useEffect, useRef, useState } from "react";
import algosdk from "algosdk";
import "./App.css";
import { deployContract } from "./blockchain/deploy";
import { depositAlgo } from "./blockchain/deposit";
import { getSavings } from "./blockchain/read";
import { isOptedIn } from "./blockchain/checkOptin";
import { optInApp } from "./blockchain/optin";
import { getMilestoneThresholds, type Milestone } from "./blockchain/milestones";
import { getDepositHistory, type DepositHistoryItem } from "./blockchain/history";

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

const CONNECT_MODAL_CLOSED = "CONNECT_MODAL_CLOSED";
const LAST_APP_ID_KEY = "savingsVault:lastAppId";
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

function App() {
  const walletRef = useRef<WalletInstance | null>(null);

  const [accountAddress, setAccountAddress] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Loading wallet...");

  const [appId, setAppId] = useState<string | null>(null);
  const [appIdInput, setAppIdInput] = useState("");
  const [amount, setAmount] = useState("");
  const [savings, setSavings] = useState(0);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [depositHistory, setDepositHistory] = useState<DepositHistoryItem[]>([]);

  const [isOpted, setIsOpted] = useState<boolean | null>(null); // ✅ FIXED LOCATION
  const [optimisticOptInKey, setOptimisticOptInKey] = useState<string | null>(null);

  const shortAddress = accountAddress
    ? `${accountAddress.slice(0, 6)}...${accountAddress.slice(-6)}`
    : "Not connected";

  const appAddress = appId
    ? algosdk.getApplicationAddress(Number(appId)).toString()
    : null;

  const currentOptInKey = accountAddress && appId ? `${accountAddress}:${appId}` : null;
  const effectiveIsOpted = isOpted === true || optimisticOptInKey === currentOptInKey;

  function handleDisconnect() {
    const wallet = walletRef.current;
    if (!wallet) return;

    void wallet.disconnect();
    setAccountAddress(null);
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
          setStatusMessage("Connect wallet.");
        }
      } catch (err) {
        console.error(err);
        setStatusMessage("Wallet init failed.");
      } finally {
        if (isMounted) setIsBusy(false);
      }
    }

    init();

    return () => {
      isMounted = false;
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

  async function handleConnect() {
    setIsBusy(true);

    try {
      const wallet = await ensureWallet();
      const accounts = await wallet.connect();

      wallet.connector?.on("disconnect", handleDisconnect);

      setAccountAddress(accounts[0]);
      setStatusMessage("Connected.");
    } catch (error) {
      const connectError = error as { data?: { type?: string } };

      if (connectError?.data?.type === CONNECT_MODAL_CLOSED) {
        setStatusMessage("Cancelled.");
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
    setDepositHistory(history);
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
      checkUserOptIn();
      fetchSavings();
      fetchDepositHistory();
      fetchMilestones();
    }
  }, [accountAddress, appId]);

  useEffect(() => {
    if (!appId) return;
    void fetchMilestones(Number(appId));
  }, [savings, appId]);

  async function handleDeploy() {
    if (!accountAddress) return;

    setStatusMessage("Deploying...");

    const deployedAppId = await deployContract(
      accountAddress,
      walletRef.current
    );

    if (deployedAppId !== null) {
      setAppId(deployedAppId.toString());
      setIsOpted(null);
      setOptimisticOptInKey(null);
      setStatusMessage("Deployed successfully!");
      await fetchSavings(deployedAppId);
      await checkUserOptIn(deployedAppId);
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
    setStatusMessage("App ID loaded. Fetching savings...");

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
        throw new Error("Account is not opted in yet. Please click Opt-In to App first.");
      }

      setStatusMessage("Processing deposit...");

      await depositAlgo(
        accountAddress,
        numericAppId,
        Number(amount),
        walletRef.current
      );

      await fetchSavings(numericAppId);
      await fetchDepositHistory(numericAppId);

      setStatusMessage("Deposit complete!");
      setAmount("");

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

      await optInApp(
        accountAddress,
        numericAppId,
        walletRef.current
      );

      setIsOpted(true);
      setOptimisticOptInKey(`${accountAddress}:${numericAppId}`);
      setStatusMessage("Opt-in complete! You can deposit now.");
      await fetchSavings(numericAppId);
      await fetchDepositHistory(numericAppId);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Opt-in failed.";
      setStatusMessage(`Opt-in failed: ${message}`);
    }
  }

  const isConnected = Boolean(accountAddress);

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Savings Vault</p>
        <h1>Savings Vault 💰</h1>
        <p className="intro">
          Connect your wallet, deploy a vault app, and track your on-chain savings in real time.
        </p>

        <div className="action-row">
          <button className="primary-button" onClick={handleConnect} disabled={isBusy || isConnected}>
            Connect Wallet
          </button>

          <button className="secondary-button" onClick={handleDisconnect} disabled={!isConnected}>
            Disconnect
          </button>

          <button className="primary-button" onClick={handleDeploy} disabled={!isConnected}>
            Deploy Contract
          </button>
        </div>

        <p className="status-line">{statusMessage}</p>
      </section>

      <section className="details-grid">
        <article className="detail-card">
          <span className="detail-label">Account</span>
          <strong>{shortAddress}</strong>
        </article>

        <article className="detail-card">
          <span className="detail-label">App ID</span>
          <strong>{appId ?? "-"}</strong>
        </article>

        <article className="detail-card">
          <span className="detail-label">Your Savings</span>
          <strong>{savings.toFixed(6)} ALGO</strong>
        </article>
      </section>

      <section className="notes-panel">
        <h2>Use Existing App</h2>
        <div className="action-row">
          <input
            className="text-input"
            type="number"
            min="1"
            placeholder="Enter existing App ID"
            value={appIdInput}
            onChange={(e) => setAppIdInput(e.target.value)}
          />
          <button className="secondary-button" onClick={handleUseAppId} disabled={!appIdInput.trim()}>
            Load App ID
          </button>
        </div>
      </section>

      <section className="notes-panel">
        <h2>Deposit ALGO</h2>
        <div className="action-row">
          <input
            className="text-input"
            type="number"
            min="0"
            step="0.000001"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button className="primary-button" onClick={handleDeposit} disabled={!appId || !amount}>
            Deposit
          </button>
          {!effectiveIsOpted && (
            <button className="secondary-button" onClick={handleOptIn} disabled={!appId || !isConnected}>
              Opt-In to App
            </button>
          )}
        </div>
        <p className="status-line">
          Opt-In Status: {effectiveIsOpted ? "Opted in" : isOpted === null ? "Checking..." : "Not opted in"}
        </p>
        <p className="status-line">App Address: <code>{appAddress ?? "-"}</code></p>
      </section>

      <section className="notes-panel">
        <h2>Milestone Badges</h2>
        <div className="milestone-grid">
          {milestones.length === 0 && <p className="status-line">No milestones configured.</p>}
          {milestones.map((milestone) => (
            <article
              key={milestone.label}
              className={`milestone-badge ${milestone.unlocked ? "is-unlocked" : "is-locked"}`}
            >
              <span className="milestone-icon">{milestone.unlocked ? "🏆" : "🔒"}</span>
              <span className="detail-label">{milestone.label}</span>
              <strong>{milestone.thresholdAlgo.toFixed(2)} ALGO</strong>
              <span className="milestone-state">
                {milestone.unlocked ? "Unlocked" : "Locked"}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="notes-panel">
        <h2>Deposit History</h2>
        {depositHistory.length === 0 ? (
          <p className="status-line">No deposits found yet.</p>
        ) : (
          <div className="action-row">
            {depositHistory.slice(0, 8).map((item) => (
              <article key={item.txId} className="detail-card">
                <span className="detail-label">App ID: {item.appId}</span>
                <span className="detail-label">{item.amountAlgo.toFixed(6)} ALGO</span>
                <span className="status-line">Round: {item.confirmedRound}</span>
                <button
                  className="secondary-button"
                  onClick={() => void loadAppIdValue(item.appId)}
                >
                  Use This App
                </button>
                <code>{item.txId}</code>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;