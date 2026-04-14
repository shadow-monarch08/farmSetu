import algosdk from 'algosdk';
import axios from 'axios';
import * as crypto from 'crypto';

// The AGMARKNET API URL (Daily Mandi Prices)
const DATA_GOV_API = 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';

async function fetchAgmarknetPrice(commodity: string, apiKey: string): Promise<number> {
  console.log(`[Oracle] Fetching live data for ${commodity} from AGMARKNET...`);
  try {
    const response = await axios.get(DATA_GOV_API, {
      params: {
        'api-key': apiKey,
        'format': 'json',
        'filters[commodity]': commodity,
        'limit': 10 // Fetch top 10 markets to find a median
      },
      timeout: 5000
    });

    const records = response.data.records;
    if (!records || records.length === 0) throw new Error("No records found");

    const prices = records.map((r: any) => parseFloat(r.modal_price)).sort((a: number, b: number) => a - b);
    const medianPrice = prices[Math.floor(prices.length / 2)];
    
    console.log(`[Oracle] Real-time median price for ${commodity}: ₹${medianPrice}/quintal`);
    return medianPrice;

  } catch (error) {
    console.warn(`[Oracle] Government API failed or timed out. Falling back to Hackathon Mock Data.`);
    const mockPrices: Record<string, number> = {
      'Wheat': 2250,
      'Soyabean': 4800,
      'Cotton': 7100
    };
    return mockPrices[commodity] || 2000;
  }
}

async function main() {
  console.log('--- FarmSetu Oracle Node Starting ---');

  // BYPASS ALL NETWORKING: Generate a strictly local identity
  const oracleAccount = algosdk.generateAccount();
  console.log(`[Oracle] Public Key (Address): ${oracleAccount.addr}`);
  console.log(`[Oracle] Private Key configured in-memory.`);

  // Configuration
  const apiKey = process.env.DATA_GOV_API_KEY || 'mock-key'; 
  const commodity = 'Wheat';

  // Fetch the Price
  const pricePerQuintal = await fetchAgmarknetPrice(commodity, apiKey);
  
  // Data Formatting
  const pricePaise = Math.round(pricePerQuintal * 100);
  const timestamp = Math.floor(Date.now() / 1000);

  // Cryptographic Signing
  console.log(`[Oracle] Cryptographically signing data payload...`);
  
  const msgBuffer = Buffer.concat([
    Buffer.from(commodity),
    algosdk.encodeUint64(pricePaise),
    algosdk.encodeUint64(timestamp),
  ]);

  const msgHash = crypto.createHash('sha256').update(msgBuffer).digest();
  const signature = algosdk.signBytes(msgHash, oracleAccount.sk);

  console.log(`[Oracle] ✅ Payload Signed!`);
  console.log(`   -> Commodity: ${commodity}`);
  console.log(`   -> Price (Paise): ${pricePaise}`);
  console.log(`   -> Timestamp: ${timestamp}`);
  console.log(`   -> Signature: ${Buffer.from(signature).toString('hex').substring(0, 32)}...`);
}

main().catch(console.error);