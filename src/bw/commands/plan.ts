/**
 * bw plan create <name> <price>
 *
 * Create a subscription plan on the contract.
 *
 *   bw plan create "Basic" 100   — create plan at 100 sats/day
 *
 * Prints the created plan ID to stdout.
 */

import { getContract, JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import type { Addressbook } from '../../fund-manager/types.js';
import { resolveWallet } from '../../fund-manager/addressbook.js';
import {
    BLOCKHOST_SUBSCRIPTIONS_ABI,
    type IBlockhostSubscriptions,
} from '../../fund-manager/contract-abis.js';

export async function planCommand(
    args: string[],
    book: Addressbook,
    provider: JSONRpcProvider,
    _contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    if (args.length < 1) {
        console.error('Usage: bw plan create <name> <price>');
        console.error('  name:  plan name (string)');
        console.error('  price: price per day (integer)');
        process.exit(1);
    }

    const subcommand = args[0];

    if (subcommand !== 'create') {
        console.error(`Unknown plan subcommand: ${subcommand}`);
        console.error('Available: create');
        process.exit(1);
    }

    if (args.length < 3) {
        console.error('Usage: bw plan create <name> <price>');
        process.exit(1);
    }

    const name = args[1];
    const priceStr = args[2];

    if (!name || !priceStr) {
        console.error('Usage: bw plan create <name> <price>');
        process.exit(1);
    }

    const price = parseInt(priceStr, 10);
    if (isNaN(price) || price <= 0) {
        console.error(
            `Invalid price: ${priceStr} (must be a positive integer)`,
        );
        process.exit(1);
    }

    const serverWallet = resolveWallet('server', book, network);
    if (!serverWallet) {
        console.error(
            'Error: server wallet not available for signing',
        );
        process.exit(1);
    }

    const signedContract = getContract<IBlockhostSubscriptions>(
        _contract.address,
        BLOCKHOST_SUBSCRIPTIONS_ABI,
        provider,
        network,
        serverWallet.address,
    );

    const sim = await signedContract.createPlan(
        name,
        BigInt(price),
    );

    if ('error' in sim) {
        console.error(`createPlan failed: ${sim.error}`);
        process.exit(1);
    }

    const result = await sim.sendTransaction({
        signer: serverWallet.keypair,
        mldsaSigner: serverWallet.mldsaKeypair,
        refundTo: serverWallet.p2tr,
        maximumAllowedSatToSpend: 100_000n,
        feeRate: 15,
        network,
    });

    // Extract plan ID from the simulation result properties
    if (sim.properties.planId !== undefined) {
        console.log(sim.properties.planId.toString());
    } else {
        // Check events for PlanCreated
        if (result && 'events' in result) {
            const events = result.events as Array<{ name: string; values: Record<string, unknown> }>;
            const planEvent = events.find(
                (e) => e.name === 'PlanCreated',
            );
            if (planEvent) {
                console.log(
                    String(planEvent.values['planId']),
                );
                return;
            }
        }
        console.error(
            'Warning: could not extract plan ID from result',
        );
        process.exit(1);
    }
}
