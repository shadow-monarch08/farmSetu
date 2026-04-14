#!/bin/bash
echo "🔗 Starting FarmSetu in REAL ONCHAIN MODE..."
echo "📡 Connected to Algorand Testnet"
echo ""
VITE_NODE_URL=https://testnet-api.algonode.cloud \
VITE_INDEXER_URL=https://testnet-idx.algonode.cloud \
VITE_CONTRACT_MODE=onchain \
pnpm dev -- --host 0.0.0.0
