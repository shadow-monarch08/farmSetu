import { useWallet } from '../hooks/useWallet'; 
import { createForwardContract } from '../services/contractService';

export const CreateTradeButton = () => {
  const walletState = useWallet(); 

  const handleCreateTrade = async () => {
    // 1. Extract the exact properties exported by your useWallet hook
    const userAddress = walletState.accountAddress;
    const walletInstance = walletState.wallet;

    if (!userAddress || !walletInstance) {
      alert("Please connect your Pera wallet first!");
      return;
    }

    try {
      // 2. Satisfy the CreateContractInput interface exactly
      const mockInput = {
        farmerAddress: userAddress,
        cropName: "WHEAT",
        quantity: 100,
        agreedPrice: 2250,
        state: "Haryana",
      };
      
      console.log("[UI] Initiating Atomic Deployment & Registration...");
      
      // 3. Pass the nested walletInstance, not the outer walletState
      const result = await createForwardContract(mockInput, walletInstance, userAddress);
      
      console.log(`[UI] Success! App ID: ${result.appId} | Txn: ${result.txnId}`);
      alert(`Trade Registered! App ID: ${result.appId}`);
      
    } catch (error) {
      console.error("Smart Contract Error:", error);
      alert("Deployment failed. Check console.");
    }
  };

  return (
    <button 
      onClick={handleCreateTrade} 
      className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      disabled={walletState.isLoading}
    >
      {walletState.isLoading ? "Loading Wallet..." : "Deploy & Register Contract"}
    </button>
  );
};