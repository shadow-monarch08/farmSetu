import { useEffect, useState } from "react";
import type { UseWalletResult } from "../hooks/useWallet";
import { useAuth } from "../hooks/useAuth";

interface LoginPageProps {
  wallet: UseWalletResult;
}

function LoginPage({ wallet }: LoginPageProps) {
  const { login } = useAuth();
  const [connectingRole, setConnectingRole] = useState<"farmer" | "buyer" | null>(null);

  const handleConnect = async (role: "farmer" | "buyer") => {
    if (wallet.isConnected && wallet.accountAddress) {
      login(role, wallet.accountAddress);
      return;
    }

    setConnectingRole(role);
    try {
      await wallet.connect();
      // The wallet connection will trigger the auth state update in useEffect below
    } catch (error) {
      console.error("Connection failed:", error);
      setConnectingRole(null);
    }
  };

  // Auto-login when wallet connects after a deliberate role selection.
  useEffect(() => {
    if (wallet.isConnected && wallet.accountAddress && connectingRole) {
      login(connectingRole, wallet.accountAddress);
      setConnectingRole(null);
    }
  }, [wallet.isConnected, wallet.accountAddress, connectingRole, login]);

  return (
    <div className="min-h-screen py-8">
      <header className="fs-shell fs-glass rounded-2xl px-6 py-5 sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-green-700">
              FarmSetu
            </p>
            <h1 className="mt-1 text-3xl font-extrabold text-slate-900 sm:text-4xl">
              Forward Contract Platform
            </h1>
          </div>
          <div className="text-sm font-semibold text-slate-700 sm:text-right">
            <p>Powered by Algorand</p>
            <p className="text-green-700">TestNet Ready</p>
          </div>
        </div>
      </header>

      <main className="fs-shell mt-7">
        <section className="fs-card rounded-3xl px-6 py-10 text-center sm:px-12">
          <h2 className="text-4xl font-extrabold tracking-tight text-slate-900">
            Secure Your Crop Prices With Confidence
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-lg leading-relaxed text-slate-600">
            Connect your wallet and start transparent forward contracts between farmers
            and buyers with clear terms, locked pricing, and on-chain trust.
          </p>
        </section>

        <section className="mt-7 grid gap-6 lg:grid-cols-2">
          <article className="fs-card rounded-2xl p-7">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-700">
              For Farmers
            </p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900">Create and lock terms</h3>
            <p className="mt-3 text-slate-600">
              Publish crop contracts with your quantity and target price to reduce
              volatility and secure demand before harvest.
            </p>
            <ul className="mt-5 space-y-2 text-sm font-medium text-slate-700">
              <li>Set your own crop prices</li>
              <li>Reduce market uncertainty</li>
              <li>Track transparent status changes</li>
              <li>Connect directly to buyers</li>
            </ul>
            <button
              onClick={() => handleConnect("farmer")}
              disabled={wallet.isLoading || connectingRole !== null}
              className="fs-btn fs-btn-primary mt-6 w-full px-5 py-3.5"
            >
              {connectingRole === "farmer"
                ? "Connecting..."
                : wallet.isLoading
                ? "Loading..."
                : "Connect as Farmer"}
            </button>
          </article>

          <article className="fs-card rounded-2xl p-7">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
              For Buyers
            </p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900">Secure supply early</h3>
            <p className="mt-3 text-slate-600">
              Browse active contracts, accept the right deals, and settle outcomes using
              verified on-chain settlement logic.
            </p>
            <ul className="mt-5 space-y-2 text-sm font-medium text-slate-700">
              <li>Access farmer-created contracts</li>
              <li>Plan supply with price certainty</li>
              <li>Deposit and settle on-chain</li>
              <li>Build reliable partnerships</li>
            </ul>
            <button
              onClick={() => handleConnect("buyer")}
              disabled={wallet.isLoading || connectingRole !== null}
              className="fs-btn fs-btn-primary mt-6 w-full px-5 py-3.5"
            >
              {connectingRole === "buyer"
                ? "Connecting..."
                : wallet.isLoading
                ? "Loading..."
                : "Connect as Buyer"}
            </button>
          </article>
        </section>

        {wallet.error && (
          <div className="mt-7 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            Connection error: {wallet.error}
          </div>
        )}
      </main>
    </div>
  );
}

export default LoginPage;