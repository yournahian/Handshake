import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createWalletClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "@/lib/wagmi";
import { publicClient } from "@/lib/publicClient";
import { escrowAbi, DEPLOYED_ESCROW_ADDRESS } from "@/lib/contracts";

export async function POST(request: Request) {
  let jobId: any = null;
  let buyerAuthorizedUpdated = false;

  try {
    const body = await request.json();
    jobId = body.jobId;

    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (hasSupabase && jobId) {
      try {
        await supabase.from("escrow_submissions").update({
          buyer_authorized: true,
          status: "Approved",
          result: "Escrow payment released manually by buyer."
        }).eq("job_id", Number(jobId));
        buyerAuthorizedUpdated = true;
      } catch (err: any) {
        console.warn("POST Route direct Supabase release authorization update failed:", err.message || err);
      }
    }

    // 1. Try forwarding to bot server if running (configurable via BOT_SERVER_URL)
    const botUrl = process.env.BOT_SERVER_URL || process.env.NEXT_PUBLIC_BOT_SERVER_URL || "http://localhost:4000";
    try {
      const res = await fetch(`${botUrl.replace(/\/$/, "")}/api/escrow/release`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
      }
    } catch (botErr: any) {
      console.warn(`Calling bot server at ${botUrl} failed:`, botErr.message || botErr);
    }

    // 2. Direct On-Chain Execution Fallback if BOT_PRIVATE_KEY is available in Web environment
    const botPrivateKey = process.env.BOT_PRIVATE_KEY;
    if (botPrivateKey && botPrivateKey.startsWith("0x") && botPrivateKey.length === 66 && jobId) {
      try {
        console.log(`[API Escrow Release] Attempting direct on-chain release for Job #${jobId}...`);
        const account = privateKeyToAccount(botPrivateKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: arcTestnet,
          transport: http("https://rpc.testnet.arc.network"),
        });

        const reasonHash = keccak256(toHex("BUYER_MANUAL_APPROVED"));
        const { request: simReq } = await publicClient.simulateContract({
          address: DEPLOYED_ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: "complete",
          args: [BigInt(jobId), reasonHash, "0x"],
          account,
        });

        const txHash = await walletClient.writeContract(simReq);
        console.log(`[API Escrow Release] Direct on-chain release succeeded! Tx Hash: ${txHash}`);

        if (hasSupabase) {
          try {
            await supabase.from("escrow_submissions").update({
              status: "Approved",
              result: `Escrow payment released manually by buyer. Tx Hash: ${txHash}`
            }).eq("job_id", Number(jobId));
          } catch (dbErr) {}
        }

        return NextResponse.json({
          success: true,
          txHash,
          message: `Escrow payment released successfully on-chain! Tx Hash: ${txHash}`
        });
      } catch (chainErr: any) {
        console.error(`[API Escrow Release] Direct on-chain execution failed:`, chainErr.message || chainErr);
      }
    }

    // 3. If Supabase was updated, the bot polling worker will process it
    if (buyerAuthorizedUpdated) {
      return NextResponse.json({
        success: true,
        pending: true,
        message: "Release authorized! Cloud evaluator bot will settle payment on-chain shortly."
      });
    }

    return NextResponse.json({
      error: "Payout gateway (bot server) is offline. Please ensure the bot is running on Render or locally."
    }, { status: 503 });

  } catch (error: any) {
    console.error("Failed to process escrow release:", error.message || error);
    return NextResponse.json({ error: error.message || "Failed to release escrow payment." }, { status: 500 });
  }
}
