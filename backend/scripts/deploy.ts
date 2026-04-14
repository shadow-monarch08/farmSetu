import { AlgorandClient, algos } from '@algorandfoundation/algokit-utils';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('Starting FarmSetu LocalNet Deployment...');

  // 1. Initialize LocalNet Client
  const algorand = AlgorandClient.defaultLocalNet();
  
  // Use the strict 'algos()' helper to prevent unit-conversion bugs
  const deployer = await algorand.account.fromEnvironment('DEPLOYER', algos(100));
  console.log(`Deployer Address: ${deployer.addr}`);

  // 2. Deploy Mock USDC
  console.log('Deploying Mock USDCa...');
  const usdcCreateTx = await algorand.send.assetCreate({
    sender: deployer.addr,
    total: 1000000_000000n, // 1M USDC (6 decimals)
    decimals: 6,
    assetName: 'USDCa',
    unitName: 'USDC',
  });
  const mockUsdcId = BigInt(usdcCreateTx.confirmation.assetIndex!);
  console.log(`Mock USDC ID: ${mockUsdcId}`);

  // 3. Load Artifacts
  const vaultArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/artifacts/CollateralVault.arc32.json'), 'utf-8'));
  const factoryArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/artifacts/FarmSetuFactory.arc32.json'), 'utf-8'));

  // 4. Deploy CollateralVault
  console.log('Deploying CollateralVault...');
  const vaultFactory = algorand.client.getAppFactory({
    appSpec: vaultArtifact,     // Modern syntax
    defaultSender: deployer.addr,
  });
  const vaultDeployResult = await vaultFactory.deploy({
    createParams: { method: 'createApplication', args: [mockUsdcId] }
  });
  const vaultAppId = vaultDeployResult.appClient.appId;
  const vaultAddress = vaultDeployResult.appClient.appAddress;
  console.log(`Vault App ID: ${vaultAppId} | Address: ${vaultAddress}`);

  // 5. Deploy FarmSetuFactory
  console.log('Deploying FarmSetuFactory...');
  const factoryAppFactory = algorand.client.getAppFactory({
    appSpec: factoryArtifact,   // Modern syntax
    defaultSender: deployer.addr,
  });
  const factoryDeployResult = await factoryAppFactory.deploy({
    createParams: { method: 'createApplication', args: [] }
  });
  const factoryAppId = factoryDeployResult.appClient.appId;
  const factoryAddress = factoryDeployResult.appClient.appAddress;
  console.log(`Factory App ID: ${factoryAppId} | Address: ${factoryAddress}`);

  // 6. Wire Them Together (Orchestration)
  console.log('Wiring contracts together...');
  await vaultDeployResult.appClient.send.call({
    method: 'setFactoryAddress',
    args: [factoryAddress]
  });
  
  await factoryDeployResult.appClient.send.call({
    method: 'setVault',
    args: [vaultAppId]
  });

  console.log('Deployment & Wiring Complete. Protocol is Live on LocalNet.');
}

main().catch(console.error);