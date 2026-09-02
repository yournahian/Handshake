import { createPublicClient, createWalletClient, http, custom, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const PRIVATE_KEY = process.env.BOT_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  throw new Error("BOT_PRIVATE_KEY environment variable is not set. Add it to your .env file.");
}

// Define the custom Arc Testnet chain matching viem standards
export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: {
    decimals: 18, // 18 native decimals internally for gas accounting (which is USDC)
    name: "USD Coin",
    symbol: "USDC",
  },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
} as const;

// Create Viem Clients
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

export const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

export const walletClient = createWalletClient({
  chain: arcTestnet,
  transport: http(),
  account,
});

// Simplified ABIs for internal use without needing hardhat file structure
export const escrowAbi = [
  // Events
  {
    type: "event",
    name: "JobCreated",
    inputs: [
      { name: "jobId",    type: "uint256", indexed: true },
      { name: "client",   type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "evaluator",type: "address", indexed: false },
      { name: "expiredAt",type: "uint256", indexed: false },
      { name: "hook",     type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Funded",
    inputs: [
      { name: "jobId",  type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Completed",
    inputs: [
      { name: "jobId",  type: "uint256", indexed: true },
      { name: "reason", type: "bytes32", indexed: false },
    ],
  },
  // Functions
  {
    type: "function",
    name: "nextJobId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setQrConfirmation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "qrHash", type: "bytes32" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "optParams", type: "bytes" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
      { name: "optParams", type: "bytes" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "complete",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reason", type: "bytes32" },
      { name: "optParams", type: "bytes" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reason", type: "bytes32" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "qrRelease",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "code", type: "string" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "dispute",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "resolution", type: "uint8" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveDisputeCustom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "clientShare", type: "uint256" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refundExpired",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "client", type: "address" },
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "description", type: "string" },
      { name: "budget", type: "uint256" },
      { name: "expiredAt", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "hook", type: "address" }
    ],
  },
  {
    type: "function",
    name: "jobs",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "client", type: "address" },
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "description", type: "string" },
      { name: "budget", type: "uint256" },
      { name: "expiredAt", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "hook", type: "address" },
      { name: "deliverableHash", type: "bytes32" },
      { name: "qrConfirmationHash", type: "bytes32" }
    ],
  }
] as const;

export const treasuryAbi = [
  { type: "function", name: "getBalance",      stateMutability: "view", inputs: [],                                     outputs: [{ type: "uint256" }] },
  { type: "function", name: "getMembersCount", stateMutability: "view", inputs: [],                                     outputs: [{ type: "uint256" }] },
  { type: "function", name: "nextProposalId",  stateMutability: "view", inputs: [],                                     outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "proposals", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "id",             type: "uint256" },
      { name: "proposer",       type: "address" },
      { name: "recipient",      type: "address" },
      { name: "amount",         type: "uint256" },
      { name: "description",    type: "string"  },
      { name: "votesFor",       type: "uint256" },
      { name: "votesAgainst",   type: "uint256" },
      { name: "votingDeadline", type: "uint256" },
      { name: "executed",       type: "bool"    },
      { name: "rejected",       type: "bool"    },
    ],
  },
] as const;

// Deployed Addresses
export const DEPLOYED_ESCROW_ADDRESS   = (process.env.ESCROW_ADDRESS   || "0xA54c4B856a42781c87867106E742c5651b81e037") as `0x${string}`;
export const DEPLOYED_TREASURY_ADDRESS = (process.env.TREASURY_ADDRESS || "0x29984fd25B15Cd271e4ebAD350a2Ca2269a65304") as `0x${string}`;

/**
 * Fetches live treasury stats: balance, member count, active proposal count.
 */
export async function getTreasuryStats(customAddress?: string) {
  const targetAddress = (customAddress || DEPLOYED_TREASURY_ADDRESS) as `0x${string}`;
  try {
    const [balanceRaw, membersCountRaw, nextIdRaw] = await Promise.all([
      publicClient.readContract({ address: targetAddress, abi: treasuryAbi, functionName: "getBalance" }),
      publicClient.readContract({ address: targetAddress, abi: treasuryAbi, functionName: "getMembersCount" }),
      publicClient.readContract({ address: targetAddress, abi: treasuryAbi, functionName: "nextProposalId" }),
    ]);

    const balance        = (Number(balanceRaw as bigint) / 1e6).toFixed(2);
    const members        = Number(membersCountRaw as bigint);
    const totalProposals = Number(nextIdRaw as bigint);

    // Count active proposals (not executed, not rejected, deadline not passed)
    let active = 0;
    const now = Math.floor(Date.now() / 1000);
    for (let i = 1; i <= totalProposals; i++) {
      try {
        const p = await publicClient.readContract({
          address: targetAddress,
          //@ts-ignore
          abi: treasuryAbi,
          functionName: "proposals",
          args: [BigInt(i)],
        }) as readonly [bigint, string, string, bigint, string, bigint, bigint, bigint, boolean, boolean];
        if (!p[8] && !p[9] && Number(p[7]) > now) active++;
      } catch { /* skip */ }
    }

    return { balance, members, totalProposals, active };
  } catch (error) {
    console.error("Failed to fetch treasury stats:", error);
    return null;
  }
}


/**
 * Gets the status and description of an onchain job
 */
export async function getJobDetails(jobId: bigint) {
  try {
    const data = await publicClient.readContract({
      address: DEPLOYED_ESCROW_ADDRESS,
      abi: escrowAbi,
      //@ts-ignore
      functionName: "jobs",
      args: [jobId],
    });
    return data;
  } catch (error) {
    console.error(`Error reading job ${jobId}:`, error);
    return null;
  }
}

/**
 * Executes a 'complete' transaction to release funds from escrow
 */
export async function releaseEscrow(jobId: bigint, reasonHash: `0x${string}`) {
  try {
    const { request } = await publicClient.simulateContract({
      address: DEPLOYED_ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "complete",
      args: [jobId, reasonHash, "0x"],
      account,
    });

    const hash = await walletClient.writeContract(request);
    console.log(`Released escrow for job ${jobId}. Tx Hash: ${hash}`);
    return hash;
  } catch (error) {
    console.error(`Failed to release escrow for job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Executes a 'reject' transaction to revert job state to Funded
 */
export async function rejectSubmission(jobId: bigint, reasonHash: `0x${string}`) {
  try {
    const { request } = await publicClient.simulateContract({
      address: DEPLOYED_ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "reject",
      args: [jobId, reasonHash],
      account,
    });

    const hash = await walletClient.writeContract(request);
    console.log(`Rejected submission for job ${jobId}. Tx Hash: ${hash}`);
    return hash;
  } catch (error) {
    console.error(`Failed to reject submission for job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Executes a 'resolveDispute' transaction on behalf of the bot arbitrator wallet
 */
export async function resolveDispute(jobId: bigint, resolution: number) {
  try {
    const { request } = await publicClient.simulateContract({
      address: DEPLOYED_ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "resolveDispute",
      args: [jobId, resolution],
      account,
    });

    const hash = await walletClient.writeContract(request);
    console.log(`Resolved dispute for job ${jobId} with resolution ${resolution}. Tx Hash: ${hash}`);
    return hash;
  } catch (error) {
    console.error(`Failed to resolve dispute for job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Executes a 'resolveDisputeCustom' transaction on behalf of the bot arbitrator wallet
 */
export async function resolveDisputeCustom(jobId: bigint, clientShare: bigint) {
  try {
    const { request } = await publicClient.simulateContract({
      address: DEPLOYED_ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "resolveDisputeCustom",
      args: [jobId, clientShare],
      account,
    });

    const hash = await walletClient.writeContract(request);
    console.log(`Resolved custom dispute for job ${jobId} with clientShare ${clientShare}. Tx Hash: ${hash}`);
    return hash;
  } catch (error) {
    console.error(`Failed to resolve custom dispute for job ${jobId}:`, error);
    throw error;
  }
}
