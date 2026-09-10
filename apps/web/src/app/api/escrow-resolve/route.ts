import { NextResponse } from "next/server";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "@/lib/wagmi";
import { publicClient } from "@/lib/publicClient";
import { escrowAbi, DEPLOYED_ESCROW_ADDRESS } from "@/lib/contracts";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, resolution, clientShare, adminPassword } = body;

    const expectedPassword = process.env.ADMIN_PASSWORD || "admin123";
    if (adminPassword !== expectedPassword) {
      return NextResponse.json({ error: "Invalid Admin Password. Access denied." }, { status: 401 });
    }

    // 1. Try bot server if reachable
    const botUrl = process.env.BOT_SERVER_URL || process.env.NEXT_PUBLIC_BOT_SERVER_URL || "http://localhost:4000";
    try {
      const res = await fetch(`${botUrl.replace(/\/$/, "")}/api/escrow/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId, resolution, clientShare }),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
      }
    } catch (botErr: any) {
      console.warn(`Calling bot server at ${botUrl} failed:`, botErr.message || botErr);
    }

    // 2. Direct On-Chain Execution Fallback if BOT_PRIVATE_KEY is available
    const botPrivateKey = process.env.BOT_PRIVATE_KEY;
    if (botPrivateKey && botPrivateKey.startsWith("0x") && botPrivateKey.length === 66 && jobId) {
      try {
        console.log(`[API Escrow Resolve] Attempting direct on-chain dispute resolution for Job #${jobId}...`);
        const account = privateKeyToAccount(botPrivateKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: arcTestnet,
          transport: http("https://rpc.testnet.arc.network"),
        });

        let txHash: `0x${string}`;
        if (resolution === 3 && clientShare !== undefined) {
          const { request: simReq } = await publicClient.simulateContract({
            address: DEPLOYED_ESCROW_ADDRESS,
            abi: escrowAbi,
            functionName: "resolveDisputeCustom",
            args: [BigInt(jobId), BigInt(clientShare)],
            account,
          });
          txHash = await walletClient.writeContract(simReq);
        } else {
          const { request: simReq } = await publicClient.simulateContract({
            address: DEPLOYED_ESCROW_ADDRESS,
            abi: escrowAbi,
            functionName: "resolveDispute",
            args: [BigInt(jobId), Number(resolution)],
            account,
          });
          txHash = await walletClient.writeContract(simReq);
        }

        console.log(`[API Escrow Resolve] Direct on-chain resolution succeeded! Tx Hash: ${txHash}`);
        return NextResponse.json({
          success: true,
          txHash,
          message: `Dispute resolved successfully on-chain! Tx Hash: ${txHash}`
        });
      } catch (chainErr: any) {
        console.error(`[API Escrow Resolve] Direct on-chain execution failed:`, chainErr.message || chainErr);
      }
    }

    return NextResponse.json({ error: "Dispute resolution backend is offline. Please ensure the bot is running on Render or locally." }, { status: 503 });
  } catch (error: any) {
    console.error("Failed to resolve dispute:", error.message || error);
    return NextResponse.json({ error: error.message || "Failed to resolve dispute." }, { status: 500 });
  }
}
