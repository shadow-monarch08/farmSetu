import { useState } from "react";
import type {
  FarmSetuForwardContract,
  AcceptContractInput,
  SettleContractInput,
  UpdatePriceInput,
} from "../types/contract";
import AcceptContractModal from "./AcceptContractModal";
import SettleContractModal from "./SettleContractModal";
import UpdatePriceModal from "./UpdatePriceModal";

interface ContractListProps {
  contracts: FarmSetuForwardContract[];
  isLoading: boolean;
  userAddress: string;
  userRole?: "farmer" | "buyer";
  onAccept: (input: AcceptContractInput) => Promise<void>;
  onSettle: (input: SettleContractInput) => Promise<void>;
  onUpdatePrice: (input: UpdatePriceInput) => Promise<void>;
}

function ContractList({
  contracts,
  isLoading,
  userAddress,
  userRole = "farmer",
  onAccept,
  onSettle,
  onUpdatePrice,
}: ContractListProps) {
  const [selectedContract, setSelectedContract] = useState<FarmSetuForwardContract | null>(null);
  const [modalType, setModalType] = useState<"accept" | "settle" | "update_price" | null>(null);

  const handleCloseModal = () => {
    setSelectedContract(null);
    setModalType(null);
  };

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      NOT_CREATED: "bg-slate-100 text-slate-700",
      CREATED: "bg-amber-100 text-amber-800",
      ACCEPTED: "bg-blue-100 text-blue-700",
      SETTLED: "bg-emerald-100 text-emerald-800",
    };
    return statusColors[status] || "bg-slate-100 text-slate-700";
  };

  if (isLoading && contracts.length === 0) {
    return (
      <div className="fs-card rounded-2xl p-10 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-green-200 border-t-green-600"></div>
        <p className="mt-4 font-semibold text-slate-700">Loading contracts...</p>
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="fs-card rounded-2xl p-10 text-center">
        <p className="text-lg font-bold text-slate-800">No contracts found</p>
        <p className="mt-1 text-sm text-slate-600">Create a new contract to get started.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-5">
        {contracts.map((contract) => {
          const isContractOwner = contract.farmer_address === userAddress;
          const isBuyer = contract.buyer_address === userAddress;
          const isOracle = contract.oracle_address === userAddress;
          const canAccept =
            userRole === "buyer" && contract.contract_status === "CREATED" && !isContractOwner && !isBuyer;
          const canSettle =
            contract.contract_status === "ACCEPTED" &&
            ((userRole === "farmer" && isContractOwner) || (userRole === "buyer" && isBuyer));
          const canUpdatePrice = false; // Oracle-only functionality, not exposed to users
          const roleTags = [
            isContractOwner ? "Farmer" : null,
            isBuyer ? "Buyer" : null,
            isOracle ? "Oracle" : null,
          ].filter((role): role is string => role !== null);

          return (
            <article key={contract.appId} className="fs-card rounded-2xl p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900">{contract.crop_name}</h3>
                  <p className="text-sm text-slate-500">Contract #{contract.appId}</p>
                </div>
                <span
                  className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold tracking-wide ${getStatusBadge(contract.contract_status)}`}
                >
                  {contract.contract_status}
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-green-100 bg-green-50 p-3">
                  <p className="text-xs font-semibold text-green-700">Quantity (quintals)</p>
                  <p className="mt-1 text-lg font-extrabold text-green-900">{contract.quantity} qtl</p>
                </div>
                <div className="rounded-xl border border-green-100 bg-green-50 p-3">
                  <p className="text-xs font-semibold text-green-700">Agreed Forward Price</p>
                  <p className="mt-1 text-lg font-extrabold text-green-900">₹{contract.agreed_price.toLocaleString()}</p>
                  <p className="text-xs text-green-600">🤝 Contract Price (per quintal)</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-xs font-semibold text-emerald-700">Current Market Price</p>
                  <p className="mt-1 text-lg font-extrabold text-emerald-900">₹{contract.current_price.toLocaleString()}</p>
                  <p className="text-xs text-emerald-600">📊 Provided by Oracle (per quintal)</p>
                </div>
                <div className="rounded-xl border border-lime-100 bg-lime-50 p-3">
                  <p className="text-xs font-semibold text-lime-700">Total Contract Value</p>
                  <p className="mt-1 text-lg font-extrabold text-lime-900">
                    ₹{(contract.quantity * contract.agreed_price).toLocaleString()}
                  </p>
                  <p className="text-xs text-lime-600">{contract.quantity} quintals</p>
                </div>
              </div>

              {contract.contract_status === "ACCEPTED" && (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
                  Buyer Deposited: {contract.deposited_amount} ALGO
                </div>
              )}

              {contract.contract_status === "SETTLED" && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                  Settlement Amount: {contract.settlement_amount} ALGO
                </div>
              )}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-medium text-slate-600">
                  <p>Farmer: {contract.farmer_address.slice(0, 8)}...</p>
                  {roleTags.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {roleTags.map((role) => (
                        <span
                          key={`${contract.appId}-${role}`}
                          className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700"
                        >
                          Your Role: {role}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">You are viewing as spectator.</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canAccept && (
                    <button
                      onClick={() => {
                        setSelectedContract(contract);
                        setModalType("accept");
                      }}
                      className="fs-btn fs-btn-primary px-4 py-2 text-sm"
                    >
                      Accept Contract
                    </button>
                  )}

                  {canSettle && (
                    <button
                      onClick={() => {
                        setSelectedContract(contract);
                        setModalType("settle");
                      }}
                      className="fs-btn fs-btn-secondary px-4 py-2 text-sm"
                    >
                      Settle Contract
                    </button>
                  )}

                  {canUpdatePrice && (
                    <button
                      onClick={() => {
                        setSelectedContract(contract);
                        setModalType("update_price");
                      }}
                      className="fs-btn fs-btn-primary px-4 py-2 text-sm"
                    >
                      Update Price
                    </button>
                  )}

                  {contract.contract_status === "SETTLED" && (
                    <span className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
                      Completed
                    </span>
                  )}
                  {!canAccept && !canSettle && !canUpdatePrice && contract.contract_status !== "SETTLED" && (
                    <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                      No action for your role
                    </span>
                  )}
                </div>
              </div>

              <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  View Contract Details
                </summary>
                <div className="mt-3 space-y-2 text-xs text-slate-700">
                  <p className="break-all font-mono">Farmer: {contract.farmer_address}</p>
                  {contract.buyer_address && (
                    <p className="break-all font-mono">Buyer: {contract.buyer_address}</p>
                  )}
                  <p className="break-all font-mono">Oracle: {contract.oracle_address}</p>
                </div>
              </details>
            </article>
          );
        })}
      </div>

      {modalType === "accept" && selectedContract && (
        <AcceptContractModal contract={selectedContract} onAccept={onAccept} onClose={handleCloseModal} />
      )}
      {modalType === "settle" && selectedContract && (
        <SettleContractModal contract={selectedContract} onSettle={onSettle} onClose={handleCloseModal} />
      )}
      {modalType === "update_price" && selectedContract && (
        <UpdatePriceModal
          contract={selectedContract}
          onUpdatePrice={onUpdatePrice}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
}

export default ContractList;
