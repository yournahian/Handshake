import { createPublicClient, http } from "viem";
import { arcTestnet } from "./wagmi";

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http("https://rpc.testnet.arc.network", {
    retryCount: 5,
    retryDelay: 1000,
    timeout: 30000,
  }),
});
