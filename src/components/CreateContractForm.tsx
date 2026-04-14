import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import type { CreateContractInput } from "../types/contract";
import { fetchCommodityPrice, INDIAN_STATES, type CommodityPrice } from "../services/marketPriceService";

interface CreateContractFormProps {
  onSubmit: (input: CreateContractInput) => Promise<void>;
  isLoading: boolean;
  userAddress: string;
}

function CreateContractForm({ onSubmit, isLoading, userAddress }: CreateContractFormProps) {
  const [formData, setFormData] = useState<CreateContractInput>({
    farmerAddress: userAddress,
    cropName: "",
    quantity: 0,
    agreedPrice: 0,
    state: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [marketPrice, setMarketPrice] = useState<CommodityPrice | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (name === "quantity" || name === "agreedPrice") {
      const parsed = Number.parseFloat(value);
      const nonNegative = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      setFormData((prev) => ({
        ...prev,
        [name]: nonNegative,
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Fetch market price when crop name or state changes
  useEffect(() => {
    const fetchPrice = async () => {
      if (!formData.cropName.trim() || !formData.state) {
        setMarketPrice(null);
        return;
      }

      setPriceLoading(true);
      try {
        const priceData = await fetchCommodityPrice(formData.cropName.trim(), formData.state);
        setMarketPrice(priceData);
      } catch (err) {
        console.error("Failed to fetch market price:", err);
        setMarketPrice(null);
      } finally {
        setPriceLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchPrice, 500); // Debounce API calls
    return () => clearTimeout(timeoutId);
  }, [formData.cropName, formData.state]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!formData.cropName.trim()) {
      setError("Crop name is required.");
      return;
    }
    if (!formData.state) {
      setError("State selection is required.");
      return;
    }
    if (formData.quantity <= 0) {
      setError("Quantity must be greater than 0.");
      return;
    }
    if (formData.agreedPrice <= 0) {
      setError("Agreed price must be greater than 0.");
      return;
    }

    try {
      await onSubmit(formData);
      setSuccess(true);
      setFormData({
        farmerAddress: userAddress,
        cropName: "",
        quantity: 0,
        agreedPrice: 0,
        state: "",
      });
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="fs-card max-w-4xl rounded-2xl p-6 sm:p-8">
      <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Create Forward Contract</h2>
      <p className="mt-2 text-sm text-slate-600">
        Define crop details and set your forward price. The oracle will provide current market prices for fair settlement.
      </p>

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-700">
          Contract created successfully. Buyers can now accept it from the contract list.
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div className="rounded-xl border border-green-200 bg-green-50 p-4">
          <label className="fs-label">Your Farmer Address</label>
          <input
            type="text"
            value={formData.farmerAddress}
            disabled
            className="fs-input font-mono text-xs"
          />
        </div>

        <div>
          <label className="fs-label">State</label>
          <select
            name="state"
            value={formData.state}
            onChange={handleChange}
            className="fs-input"
          >
            <option value="">Select your state</option>
            {INDIAN_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="fs-label">Crop Name</label>
          <input
            type="text"
            name="cropName"
            value={formData.cropName}
            onChange={handleChange}
            placeholder="Wheat, Corn, Rice, Soybean"
            className="fs-input"
          />
          {priceLoading && (
            <p className="mt-1 text-xs text-slate-500">Fetching market price...</p>
          )}
          {marketPrice && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs font-semibold text-blue-700">Current Market Price in {marketPrice.state}</p>
              <p className="text-lg font-bold text-blue-900">
                ₹{marketPrice.price.toLocaleString()} per quintal
              </p>
              <p className="text-xs text-blue-600">
                Range: ₹{marketPrice.priceRange.min.toLocaleString()} - ₹{marketPrice.priceRange.max.toLocaleString()}
              </p>
              <p className="text-xs text-blue-600">As of {marketPrice.date}</p>
              <p className="mt-1 text-xs text-blue-600">
                💡 Set your forward price based on current market conditions in your state
              </p>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="fs-label">Quantity (quintals)</label>
            <input
              type="number"
              name="quantity"
              value={formData.quantity}
              onChange={handleChange}
              placeholder="100"
              min="1"
              step="1"
              className="fs-input"
            />
            <p className="mt-1 text-xs text-slate-500">
              Enter quantity in quintals only (not KG).
            </p>
          </div>
          <div>
            <label className="fs-label">Forward Price per quintal (INR)</label>
            <input
              type="number"
              name="agreedPrice"
              value={formData.agreedPrice}
              onChange={handleChange}
              min="1"
              step="1"
              placeholder="2000"
              className="fs-input"
            />
            <p className="mt-1 text-xs text-slate-500">
              This is your agreed forward price in INR per quintal. Negative values are not allowed.
            </p>
          </div>
        </div>

        {formData.quantity > 0 && formData.agreedPrice > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Total Contract Value
            </p>
            <p className="mt-1 text-2xl font-extrabold text-emerald-900">
              ₹{(formData.quantity * formData.agreedPrice).toLocaleString()}
            </p>
            <p className="text-xs text-emerald-600">
              {formData.quantity} quintals × ₹{formData.agreedPrice.toLocaleString()} per quintal
            </p>
          </div>
        )}

        <button type="submit" disabled={isLoading} className="fs-btn fs-btn-primary w-full px-5 py-3.5">
          {isLoading ? "Creating Contract..." : "Create Contract"}
        </button>
      </form>
    </div>
  );
}

export default CreateContractForm;
