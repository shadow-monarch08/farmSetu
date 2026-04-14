import { useState } from "react";
import type { FormEvent } from "react";
import type { FarmSetuForwardContract, AcceptContractInput } from "../types/contract";

interface AcceptContractModalProps {
  contract: FarmSetuForwardContract;
  onAccept: (input: AcceptContractInput) => Promise<void>;
  onClose: () => void;
}

function AcceptContractModal({ contract, onAccept, onClose }: AcceptContractModalProps) {
  const [depositAmount, setDepositAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const requiredDeposit = contract.quantity * contract.agreed_price;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (depositAmount < 0) {
      setError("Deposit amount cannot be negative.");
      return;
    }

    if (depositAmount < requiredDeposit) {
      setError(`Deposit must be at least ${requiredDeposit} ALGO (${contract.quantity} x ${contract.agreed_price})`);
      return;
    }

    setIsLoading(true);
    try {
      await onAccept({
        contractId: contract.appId,
        buyerAddress: "",
        depositedAmount: depositAmount,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="grid min-h-full place-items-center">
        <div className="fs-card w-full max-w-md rounded-2xl p-6">
          <h2 className="text-2xl font-extrabold text-slate-900">Accept Contract</h2>

          <div className="mt-4 rounded-xl border border-green-100 bg-green-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">Crop:</span><span className="font-semibold">{contract.crop_name}</span></div>
            <div className="mt-2 flex justify-between"><span className="text-slate-600">Quantity:</span><span className="font-semibold">{contract.quantity} quintals</span></div>
            <div className="mt-2 flex justify-between"><span className="text-slate-600">Forward Price:</span><span className="font-semibold">₹{contract.agreed_price.toLocaleString()} per quintal</span></div>
            <div className="mt-3 border-t border-green-200 pt-2 text-emerald-800 font-bold flex justify-between"><span>Minimum Deposit:</span><span>{requiredDeposit} ALGO</span></div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="fs-label">Deposit Amount (ALGO)</label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => {
                  const parsed = Number.parseFloat(e.target.value);
                  setDepositAmount(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
                }}
                placeholder={String(requiredDeposit)}
                min="0"
                step="0.01"
                className="fs-input"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={onClose} className="fs-btn fs-btn-secondary px-4 py-2.5 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={isLoading} className="fs-btn fs-btn-primary px-4 py-2.5 text-sm">
                {isLoading ? "Processing..." : "Accept"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AcceptContractModal;
