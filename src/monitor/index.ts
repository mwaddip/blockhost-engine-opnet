/**
 * Event monitor for BlockhostSubscriptions contract (OPNet)
 *
 * Polls OPNet blocks for contract events and dispatches to handlers.
 * Also runs admin commands, NFT reconciliation, and fund management.
 */

import { getContract, JSONRpcProvider } from "opnet";
import { networks, type Network } from "@btc-vision/bitcoin";
import {
  BLOCKHOST_SUBSCRIPTIONS_ABI,
  type IBlockhostSubscriptions,
} from "../fund-manager/contract-abis";
import {
  handleSubscriptionCreated,
  handleSubscriptionExtended,
  handleSubscriptionCancelled,
  handlePlanCreated,
  handlePlanUpdated,
} from "../handlers";
import {
  loadAdminConfig,
  initAdminCommands,
  shutdownAdminCommands,
  processAdminCommands,
} from "../admin";
import {
  runReconciliation,
  shouldRunReconciliation,
  getReconcileInterval,
} from "../reconcile";
import {
  shouldRunFundCycle,
  runFundCycle,
  shouldRunGasCheck,
  runGasCheck,
  getFundCycleInterval,
  getGasCheckInterval,
} from "../fund-manager";
import { loadWeb3Config } from "../fund-manager/web3-config";

const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds

/**
 * Process a single block for contract events.
 *
 * tx.events is a map: { [contractP2OP: string]: NetEvent[] }
 * Raw NetEvent only has `type` (string) and `data` (Uint8Array).
 *
 * contract.decodeEvents() accepts the full map, filters by its own
 * address (P2OP lookup), and returns OPNetEvent[] with `properties`.
 */
async function processBlock(
  provider: JSONRpcProvider,
  blockNumber: bigint,
  contract: IBlockhostSubscriptions,
): Promise<void> {
  const block = await provider.getBlock(blockNumber, true);
  if (!block) return;

  for (const tx of block.transactions) {
    // decodeEvents() accepts the full events map and filters by contract address
    const decoded = contract.decodeEvents(tx.events);
    if (decoded.length === 0) continue;

    const txHash = tx.hash;
    for (const event of decoded) {
      try {
        await dispatchEvent(event, txHash, contract);
      } catch (err) {
        console.error(`Error handling event from tx ${txHash}: ${err}`);
      }
    }
  }
}

/**
 * Dispatch an ABI-decoded OPNetEvent to the appropriate handler.
 * After decodeEvents(), event.type is the name and event.properties has decoded fields.
 */
async function dispatchEvent(event: any, txHash: string, contract: IBlockhostSubscriptions): Promise<void> {
  const eventName: string = event.type ?? '';
  const props = event.properties ?? {};

  switch (eventName) {
    case "SubscriptionCreated": {
      // userEncrypted is stored on-chain (not in the event) — read via contract call
      let userEncrypted = '0x';
      try {
        const result = await contract.getUserEncrypted(BigInt(props.subscriptionId));
        userEncrypted = String((result as any).properties?.data ?? '0x');
      } catch (err) {
        console.warn(`[WARN] Could not read userEncrypted for sub ${props.subscriptionId}: ${err}`);
      }

      await handleSubscriptionCreated({
        subscriptionId: props.subscriptionId,
        planId: props.planId,
        subscriber: String(props.subscriber),
        expiresAt: props.expiresAt,
        paidAmount: props.paidAmount,
        userEncrypted,
      }, txHash);
      break;
    }

    case "SubscriptionExtended":
      await handleSubscriptionExtended({
        subscriptionId: props.subscriptionId,
        planId: props.planId,
        extendedBy: String(props.extendedBy),
        newExpiresAt: props.newExpiresAt,
        paidAmount: props.paidAmount,
      }, txHash);
      break;

    case "SubscriptionCancelled":
      await handleSubscriptionCancelled({
        subscriptionId: props.subscriptionId,
        planId: props.planId,
        subscriber: String(props.subscriber),
      }, txHash);
      break;

    case "PlanCreated":
      await handlePlanCreated({
        planId: props.planId,
        name: props.name,
        pricePerDayUsdCents: props.pricePerDay,
      }, txHash);
      break;

    case "PlanUpdated":
      await handlePlanUpdated({
        planId: props.planId,
        name: props.name,
        pricePerDayUsdCents: props.pricePerDay,
        active: props.active,
      }, txHash);
      break;

    case "AcceptingSubscriptionsChanged":
      console.log(`[INFO] AcceptingSubscriptionsChanged: ${props.accepting} - tx: ${txHash}`);
      break;

    default:
      if (eventName) {
        console.log(`[INFO] ${eventName}: ${JSON.stringify(props)} - tx: ${txHash}`);
      }
      break;
  }
}

async function main() {
  // Load configuration from web3-defaults.yaml (with env var fallback)
  let rpcUrl: string;
  let contractAddress: string;
  let network: Network;

  try {
    const web3Config = loadWeb3Config();
    rpcUrl = web3Config.rpcUrl;
    contractAddress = web3Config.subscriptionsContract;
    network = web3Config.network;
  } catch (err) {
    console.error("Error: web3-defaults.yaml not found or invalid:", err);
    process.exit(1);
  }

  console.log("==============================================");
  console.log("  BlockhostSubscriptions Event Monitor");
  console.log("==============================================");
  console.log(`Contract: ${contractAddress}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Network: ${network === networks.bitcoin ? 'mainnet' : network === networks.testnet ? 'testnet' : 'regtest'}`);
  console.log(`Poll Interval: ${POLL_INTERVAL_MS}ms`);
  console.log("----------------------------------------------\n");

  // Load admin configuration (optional)
  const adminConfig = loadAdminConfig();
  if (adminConfig) {
    console.log(`Admin commands: ENABLED (HMAC OP_RETURN)`);
    console.log(`Admin wallet: ${adminConfig.wallet_address}`);
    initAdminCommands();
  } else {
    console.log(`Admin commands: DISABLED (not configured)`);
  }
  console.log("----------------------------------------------\n");

  // Connect to the network
  const provider = new JSONRpcProvider(rpcUrl, network);
  const contract = getContract<IBlockhostSubscriptions>(
    contractAddress,
    BLOCKHOST_SUBSCRIPTIONS_ABI,
    provider,
    network,
  );

  // Start from current block
  let lastProcessedBlock = await provider.getBlockNumber();
  console.log(`Connected. Starting from block: ${lastProcessedBlock}`);
  console.log(`NFT reconciliation: every ${getReconcileInterval() / 1000}s`);
  console.log(`Fund cycle: every ${getFundCycleInterval() / 3600000}h`);
  console.log(`Gas check: every ${getGasCheckInterval() / 60000}min`);
  console.log("\nPolling for events...\n");

  // Polling loop
  let running = true;

  const poll = async () => {
    while (running) {
      try {
        const currentBlock = await provider.getBlockNumber();

        if (currentBlock > lastProcessedBlock) {
          const fromBlock = lastProcessedBlock + 1n;
          const toBlock = currentBlock;

          // Process contract events block by block
          for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
            await processBlock(provider, blockNum, contract);
          }

          // Process admin commands from transactions (if configured)
          if (adminConfig) {
            await processAdminCommands(provider, adminConfig, fromBlock, toBlock);
          }

          lastProcessedBlock = currentBlock;
        }

        // Run NFT reconciliation periodically (non-blocking health check)
        if (shouldRunReconciliation()) {
          runReconciliation(provider, network).catch((err) => {
            console.error(`[RECONCILE] Error: ${err}`);
          });
        }

        // Run fund withdrawal & distribution cycle periodically
        if (shouldRunFundCycle()) {
          runFundCycle(provider, network).catch((err) => {
            console.error(`[FUND] Error: ${err}`);
          });
        }

        // Check gas balance and swap if needed
        if (shouldRunGasCheck()) {
          runGasCheck(provider, network).catch((err) => {
            console.error(`[GAS] Error: ${err}`);
          });
        }
      } catch (err) {
        console.error(`Polling error: ${err}`);
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down monitor...");
    running = false;
    if (adminConfig) {
      await shutdownAdminCommands();
    }
    setTimeout(() => process.exit(0), 1000);
  });

  console.log("Monitor is running. Press Ctrl+C to stop.\n");
  await poll();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
