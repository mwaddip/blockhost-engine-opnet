/**
 * Event monitor for BlockhostSubscriptions contract (OPNet)
 *
 * Polls OPNet blocks for contract events and dispatches to handlers.
 * Also runs admin commands, NFT reconciliation, and fund management.
 */

import { getContract, JSONRpcProvider, type OPNetEvent, type ContractDecodedObjectResult } from "opnet";
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
  beginAdminCycle,
  processAdminCommandsInBlock,
} from "../admin";
import {
  runReconciliation,
  shouldRunReconciliation,
  getReconcileInterval,
  isProvisioningInProgress,
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
 * Dispatch an ABI-decoded OPNetEvent to the appropriate handler.
 * After decodeEvents(), event.type is the name and event.properties has decoded fields.
 *
 * `blockNum` is the height of the block where the event was emitted — passed
 * to subscription handlers so expiry-day calculations anchor to that block.
 */
async function dispatchEvent(event: OPNetEvent<ContractDecodedObjectResult>, txHash: string, blockNum: bigint, contract: IBlockhostSubscriptions): Promise<void> {
  const eventName = event.type;
  const props = event.properties;

  switch (eventName) {
    case "SubscriptionCreated": {
      const subId = props.subscriptionId as bigint;
      // userEncrypted is stored on-chain (not in the event) — read via contract call
      let userEncrypted = '0x';
      try {
        const result = await contract.getUserEncrypted(subId);
        userEncrypted = result.properties.data || '0x';
      } catch (err) {
        console.warn(`[WARN] Could not read userEncrypted for sub ${subId}: ${err}`);
      }

      await handleSubscriptionCreated({
        subscriptionId: subId,
        planId: props.planId as bigint,
        subscriber: String(props.subscriber),
        expiresAt: props.expiresAt as bigint,
        paidAmount: props.paidAmount as bigint,
        userEncrypted,
      }, txHash, blockNum);
      break;
    }

    case "SubscriptionExtended":
      await handleSubscriptionExtended({
        subscriptionId: props.subscriptionId as bigint,
        planId: props.planId as bigint,
        extendedBy: String(props.extendedBy),
        newExpiresAt: props.newExpiresAt as bigint,
        paidAmount: props.paidAmount as bigint,
      }, txHash, blockNum);
      break;

    case "SubscriptionCancelled":
      await handleSubscriptionCancelled({
        subscriptionId: props.subscriptionId as bigint,
        planId: props.planId as bigint,
        subscriber: String(props.subscriber),
      }, txHash);
      break;

    case "PlanCreated":
      await handlePlanCreated({
        planId: props.planId as bigint,
        name: props.name as string,
        pricePerDayUsdCents: props.pricePerDay as bigint,
      }, txHash);
      break;

    case "PlanUpdated":
      await handlePlanUpdated({
        planId: props.planId as bigint,
        name: props.name as string,
        pricePerDayUsdCents: props.pricePerDay as bigint,
        active: props.active as boolean,
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
    contractAddress = web3Config.subscriptionContract;
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
  console.log(`Network: ${network === networks.bitcoin ? 'mainnet' : 'testnet'}`);
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
  const provider = new JSONRpcProvider({ url: rpcUrl, network });
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
  console.log(`Fund cycle: every ${getFundCycleInterval()}`);
  console.log(`Gas check: every ${getGasCheckInterval()}`);
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

          // Load admin command DB once per cycle (picks up file changes between cycles)
          const commandDb = adminConfig ? beginAdminCycle(adminConfig) : null;

          // Fetch each block once; dispatch events + admin commands against the same fetch
          for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
            const block = await provider.getBlock(blockNum, true);
            if (!block) continue;

            for (const tx of block.transactions) {
              const decoded = contract.decodeEvents(tx.events);
              if (decoded.length === 0) continue;

              const txHash = tx.hash;
              for (const event of decoded) {
                try {
                  await dispatchEvent(event, txHash, blockNum, contract);
                } catch (err) {
                  console.error(`Error handling event from tx ${txHash}: ${err}`);
                }
              }
            }

            if (adminConfig && commandDb) {
              try {
                await processAdminCommandsInBlock(block, adminConfig, commandDb);
              } catch (err) {
                console.error(`[ADMIN] Error processing block ${blockNum}: ${err}`);
              }
            }
          }

          lastProcessedBlock = currentBlock;
        }

        // Run NFT reconciliation periodically
        if (shouldRunReconciliation()) {
          try {
            await runReconciliation(provider, network);
          } catch (err) {
            console.error(`[RECONCILE] Error: ${err}`);
          }
        }

        // Run fund withdrawal & distribution cycle periodically
        // Skip if provisioning is in progress to avoid contention
        if (shouldRunFundCycle(currentBlock) && !isProvisioningInProgress()) {
          try {
            await runFundCycle(provider, network, currentBlock);
          } catch (err) {
            console.error(`[FUND] Error: ${err}`);
          }
        }

        // Check gas balance and swap if needed
        // Skip if provisioning is in progress to avoid contention
        if (shouldRunGasCheck(currentBlock) && !isProvisioningInProgress()) {
          try {
            await runGasCheck(provider, network, currentBlock);
          } catch (err) {
            console.error(`[GAS] Error: ${err}`);
          }
        }
      } catch (err) {
        console.error(`Polling error: ${err}`);
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };

  // Handle graceful shutdown (SIGINT from Ctrl+C, SIGTERM from systemctl stop)
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // Guard against double-signal
    shuttingDown = true;
    console.log(`\n[${signal}] Shutting down monitor...`);
    running = false;
    if (adminConfig) {
      await shutdownAdminCommands();
    }
    await provider.close();
    setTimeout(() => process.exit(0), 1000);
  };

  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

  console.log("Monitor is running. Press Ctrl+C to stop.\n");
  await poll();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
