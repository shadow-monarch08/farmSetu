# FarmSetu Backend Core (MVP)

This folder contains the first on-chain backend core for FarmSetu:

- `contracts/forward/approval.teal`: forward contract app logic
- `contracts/forward/clear.teal`: clear state program
- `scripts/deploy-forward.mjs`: deploy a new forward app
- `oracle/update-price.mjs`: oracle price update transaction

## 1) Prerequisites

- Node.js 20+
- TestNet ALGO for creator + oracle accounts
- Root dependencies installed (`npm install` at project root)

## 2) Deploy Contract

From repo root (PowerShell):

```powershell
$env:CREATOR_MNEMONIC="your 25-word mnemonic"
$env:ORACLE_ADDRESS="YOUR_ORACLE_ALGORAND_ADDRESS"
$env:CROP_NAME="WHEAT"
$env:QUANTITY="100"
$env:AGREED_PRICE="10" # ALGO
node backend/scripts/deploy-forward.mjs
```

Copy the printed `APP_ID` and set in frontend `.env`:

```env
VITE_CONTRACT_MODE=onchain
VITE_FORWARD_APP_ID=<APP_ID>
VITE_NODE_URL=https://testnet-api.algonode.cloud
VITE_INDEXER_URL=https://testnet-idx.algonode.cloud
```

## 3) Oracle Price Update

```powershell
$env:ORACLE_MNEMONIC="oracle 25-word mnemonic"
$env:APP_ID="<APP_ID>"
$env:CURRENT_PRICE="12" # ALGO
node backend/oracle/update-price.mjs
```

## 4) Run End-to-End Script

```powershell
$env:FARMER_MNEMONIC="farmer 25-word mnemonic"
$env:BUYER_MNEMONIC="buyer 25-word mnemonic"
$env:ORACLE_MNEMONIC="oracle 25-word mnemonic"
$env:CROP_NAME="WHEAT"
$env:QUANTITY="100"
$env:AGREED_PRICE="10"  # ALGO
$env:UPDATED_PRICE="12" # ALGO
npm run e2e:forward
```

## 5) Run Regression Checks

```powershell
npm run test:regression
```

## Notes

- This is a minimal MVP core: create, accept (with deposit), oracle update, settle.
- Price fields are entered as ALGO in scripts/UI and converted to microALGO on-chain.
- Frontend service is now dual-mode:
  - `VITE_CONTRACT_MODE=local` for mock/testing
  - `VITE_CONTRACT_MODE=onchain` for real Algorand calls
