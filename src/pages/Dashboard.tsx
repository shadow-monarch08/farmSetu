import { useEffect, useState } from "react";
import type { UseWalletResult } from "../hooks/useWallet";
import { useContracts } from "../hooks/useContracts";
import { useAuth } from "../hooks/useAuth";
import CreateContractForm from "../components/CreateContractForm";
import ContractList from "../components/ContractList";
import TransactionHistory from "../components/TransactionHistory";

interface DashboardProps {
  wallet: UseWalletResult;
}

function Dashboard({ wallet }: DashboardProps) {
  const { userRole, userAddress, logout } = useAuth();
  const contracts = useContracts(wallet.wallet || null, wallet.accountAddress);
  const { loadContracts } = contracts;
  const [activeTab, setActiveTab] = useState<"create" | "list" | "transactions">("list");

  useEffect(() => {
    if (wallet.isConnected) {
      void loadContracts();
    }
  }, [wallet.isConnected, wallet.accountAddress, loadContracts]);

  if (wallet.isLoading || !wallet.isConnected) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="fs-card w-full max-w-md rounded-2xl p-8 text-center">
          <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-green-200 border-t-green-600"></div>
          <p className="text-lg font-bold text-slate-800">
            {wallet.isLoading ? "Loading wallet..." : "Connecting to wallet..."}
          </p>
          <p className="mt-2 text-sm text-slate-600">Please approve the request in wallet.</p>
        </div>
      </div>
    );
  }

  const tabBase = "fs-tab";
  const active = `${tabBase} fs-tab-active`;
  const safeActiveTab = userRole !== "farmer" && activeTab === "create" ? "list" : activeTab;

  const handleLogout = async () => {
    try {
      await wallet.disconnect();
    } finally {
      logout();
    }
  };

  return (
    <div className="min-h-screen py-8">
      <header className="fs-shell fs-glass rounded-2xl px-6 py-5 sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900">FarmSetu Dashboard</h1>
            <p className="mt-1 text-sm font-semibold text-green-700">
              {userRole === "farmer" ? "Farmer Workspace" : "Buyer Workspace"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
            <div className="text-sm">
              <p className="font-semibold text-slate-700">
                {userAddress
                  ? `${userAddress.slice(0, 10)}...${userAddress.slice(-8)}`
                  : "Not connected"}
              </p>
              <p className="text-xs text-slate-500 capitalize">{userRole}</p>
            </div>
            <button
              onClick={() => {
                void handleLogout();
              }}
              className="fs-btn fs-btn-secondary px-4 py-2 text-sm"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="fs-shell mt-7">
        {contracts.error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {contracts.error}
          </div>
        )}

        <div className="fs-card mb-6 rounded-2xl p-3">
          <nav className="flex flex-wrap items-center gap-2">
            {userRole === "farmer" && (
              <button
                onClick={() => setActiveTab("create")}
                className={safeActiveTab === "create" ? active : tabBase}
              >
                Create Contract
              </button>
            )}
            <button
              onClick={() => setActiveTab("list")}
              className={safeActiveTab === "list" ? active : tabBase}
            >
              {userRole === "farmer" ? "My Contracts" : "Available Contracts"} (
              {contracts.contracts.length})
            </button>
            <button
              onClick={() => setActiveTab("transactions")}
              className={safeActiveTab === "transactions" ? active : tabBase}
            >
              Transactions
            </button>
          </nav>
        </div>

        {safeActiveTab === "create" && userRole === "farmer" && (
          <CreateContractForm
            onSubmit={contracts.create}
            isLoading={contracts.isLoading}
            userAddress={wallet.accountAddress || ""}
          />
        )}

        {safeActiveTab === "list" && (
          <ContractList
            contracts={contracts.contracts}
            isLoading={contracts.isLoading}
            userAddress={wallet.accountAddress || ""}
            userRole={userRole || undefined}
            onAccept={contracts.accept}
            onSettle={contracts.settle}
            onUpdatePrice={contracts.updatePrice}
          />
        )}

        {safeActiveTab === "transactions" && (
          <TransactionHistory transactions={contracts.transactions} />
        )}
      </main>
    </div>
  );
}

export default Dashboard;
