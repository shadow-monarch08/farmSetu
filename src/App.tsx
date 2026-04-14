import { useWallet } from "./hooks/useWallet";
import { useAuth } from "./hooks/useAuth";
import { useEffect } from "react";
import Dashboard from "./pages/Dashboard";
import LoginPage from "./pages/LoginPage";
import "./index.css";

function App() {
  const wallet = useWallet();
  const { isLoggedIn, logout } = useAuth();

  // Guard against stale auth state: if wallet is not connected anymore,
  // force auth reset so the user returns to role selection.
  useEffect(() => {
    if (isLoggedIn && !wallet.isLoading && !wallet.isConnected) {
      logout();
    }
  }, [isLoggedIn, wallet.isLoading, wallet.isConnected, logout]);

  // Show login page if not logged in
  if (!isLoggedIn) {
    return <LoginPage wallet={wallet} />;
  }

  // Show dashboard if logged in
  return <Dashboard wallet={wallet} />;
}

export default App;
