import { NextRequest, NextResponse } from "next/server";

const CIRCLE_API_KEY  = process.env.CIRCLE_API_KEY?.trim() || "";
const CIRCLE_API_BASE = "https://api.circle.com/v1/w3s";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const walletId   = req.nextUrl.searchParams.get("walletId");
    const userToken  = req.nextUrl.searchParams.get("userToken");

    if (!walletId)  return NextResponse.json({ error: "walletId is required" },  { status: 400 });
    if (!userToken) return NextResponse.json({ error: "userToken is required" }, { status: 400 });

    // ── 1. Fetch balances to build tokenId -> symbol and token address maps ──
    const tokenMap: Record<string, string> = {};
    const tokenAddresses = new Set<string>();

    // Seed default Arc Testnet token contract addresses to filter out approval noise
    tokenAddresses.add("0x3600000000000000000000000000000000000000"); // USDC
    tokenAddresses.add("0x89b50855aa3be2f677cd6303cec089b5f319d72a"); // EURC
    tokenAddresses.add("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"); // Native gas

    try {
      const balRes = await fetch(`${CIRCLE_API_BASE}/wallets/${walletId}/balances`, {
        headers: {
          Authorization:  `Bearer ${CIRCLE_API_KEY}`,
          "X-User-Token": userToken,
        },
        cache: "no-store",
      });
      if (balRes.ok) {
        const balData = await balRes.json();
        const tokenBalances = balData?.data?.tokenBalances || [];
        for (const tb of tokenBalances) {
          if (tb.token?.id && tb.token?.symbol) {
            tokenMap[tb.token.id] = tb.token.symbol;
          }
          if (tb.token?.tokenAddress) {
            tokenAddresses.add(tb.token.tokenAddress.toLowerCase());
          }
        }
      }
    } catch (balErr) {
      console.warn("Failed to fetch balances for symbol mapping:", balErr);
    }

    // ── 2. Fetch transaction history ──
    const res = await fetch(
      `${CIRCLE_API_BASE}/transactions?walletIds[]=${walletId}&pageSize=20`,
      {
        headers: {
          Authorization:  `Bearer ${CIRCLE_API_KEY}`,
          "X-User-Token": userToken,
        },
        cache: "no-store",
      }
    );

    let rawList: any[] = [];
    let isFallback = false;

    if (!res.ok) {
      // Fallback: try the user-scoped endpoint
      const userRes = await fetch(
        `${CIRCLE_API_BASE}/user/transactions?walletIds[]=${walletId}&pageSize=20`,
        {
          headers: {
            Authorization:  `Bearer ${CIRCLE_API_KEY}`,
            "X-User-Token": userToken,
          },
          cache: "no-store",
        }
      );
      if (userRes.ok) {
        const userData = await userRes.json();
        rawList = userData?.data?.transactions || [];
        isFallback = true;
      }
    } else {
      const data = await res.json();
      rawList = data?.data?.transactions || [];
    }

    // ── 3. Parse & attach token symbols ──
    const allTxs = rawList.map((tx: any) => {
      const type = tx.transactionType || (tx.sourceAddress?.toLowerCase() === walletId.toLowerCase() ? "OUTBOUND" : "INBOUND");
      const amounts = tx.amounts || (tx.amount ? [tx.amount] : ["0"]);
      const symbol = tx.tokenId ? (tokenMap[tx.tokenId] || "USDC") : "USDC";

      return {
        ...tx,
        transactionType: type,
        amounts,
        tokenSymbol: symbol,
      };
    });

    // ── 4. Collect CONTRACT_EXECUTION hashes to detect swap events ──
    const swapHashes = new Set<string>();
    const SWAP_ADAPTER = "0xbbd70b01a1cabc96d5b7b129ae1aaabdf50dd40b";
    const ESCROW_ADDRESS = "0xA54c4B856a42781c87867106E742c5651b81e037".toLowerCase();
    const TREASURY_ADDRESS = "0x29984fd25B15Cd271e4ebAD350a2Ca2269a65304".toLowerCase();
    const FACTORY_ADDRESS = "0x283371AC03DeBABdd6Ef8ABef7547336c6DFB276".toLowerCase();

    for (const tx of allTxs) {
      if (tx.operation === "CONTRACT_EXECUTION" && tx.txHash && tx.txHash !== "0x") {
        if (tx.contractAddress && tx.contractAddress.toLowerCase() === SWAP_ADAPTER) {
          swapHashes.add(tx.txHash.toLowerCase());
        }
      }
    }

    // ── 5. Filter duplicates & hide approval noise ──
    const filteredTxs = allTxs.filter((tx: any) => {
      const operation = (tx.operation || "").toUpperCase();

      if (operation === "CONTRACT_EXECUTION") {
        // Exclude ERC20 approval transactions (they call the token contract address directly)
        if (tx.contractAddress && tokenAddresses.has(tx.contractAddress.toLowerCase())) {
          return false;
        }
        return !!tx.txHash && tx.txHash !== "0x";
      }

      // Filter out gas-only / zero-value transfers
      const firstAmount = parseFloat(tx.amounts?.[0] || "0");
      if (firstAmount < 0.000001) return false;
      return true;
    });

    // ── 6. Map flags & contract names ──
    const transactions = filteredTxs.map((tx: any) => {
      const txHashLower = tx.txHash?.toLowerCase();
      const isSwap = txHashLower ? swapHashes.has(txHashLower) : false;
      
      let contractLabel = "";
      if (tx.operation === "CONTRACT_EXECUTION" && tx.contractAddress) {
        const addr = tx.contractAddress.toLowerCase();
        if (addr === ESCROW_ADDRESS) {
          contractLabel = "Escrow Interaction";
        } else if (addr === TREASURY_ADDRESS) {
          contractLabel = "Treasury Interaction";
        } else if (addr === FACTORY_ADDRESS) {
          contractLabel = "Deploy Treasury (Factory)";
        } else if (addr === SWAP_ADAPTER) {
          contractLabel = "Swap Execution";
        } else {
          contractLabel = "Contract Interaction";
        }
      }

      return {
        ...tx,
        isSwapTransaction: isSwap,
        contractLabel
      };
    });

    return NextResponse.json({
      transactions,
      _debug: { total: allTxs.length, filtered: transactions.length, fallback: isFallback }
    });

  } catch (err: any) {
    console.error("[Circle /api/circle/transactions] Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
