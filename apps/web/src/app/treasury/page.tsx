"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, encodeFunctionData } from "viem";
import { DEPLOYED_FACTORY_ADDRESS, factoryAbi } from "@/lib/contracts";
import { Landmark, PlusCircle, ArrowRight, RefreshCw, AlertCircle, Settings } from "lucide-react";
import { waitForReceipt } from "@/lib/utils";
import confetti from "canvas-confetti";
import { useWallet } from "@/hooks/useWallet";
import { useCircleWallet } from "@/components/CircleWalletContext";
import { publicClient } from "@/lib/publicClient";
import { supabase } from "@/lib/supabase";

const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x3600000000000000000000000000000000000000") as `0x${string}`;

export default function TreasuryLauncher() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const router = useRouter();
  const { isConnected, address } = useWallet();
  const { executeContractCall } = useCircleWallet();

  // Unified contract writer using Circle Smart Wallet SDK
  const writeContract = useCallback(async (
    contractAddress: string,
    abi: any,
    functionName: string,
    args: any[],
  ): Promise<`0x${string}`> => {
    const calldata = encodeFunctionData({ abi, functionName: functionName as any, args });
    const txHash = await executeContractCall({
      contractAddress,
      abiFunctionSignature: "execute(bytes)",
      abiParameters: [{ type: "callData", value: calldata }],
      amount: "0",
    });
    return (txHash || "0x") as `0x${string}`;
  }, [executeContractCall]);

  const [existingAddress, setExistingAddress] = useState("");
  const [existingName, setExistingName] = useState("");
  const [poolName, setPoolName] = useState("");
  const [savedPools, setSavedPools] = useState<Array<{ address: string; name: string }>>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [txPendingMessage, setTxPendingMessage] = useState<string | null>(null);

  // Custom Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const alert = React.useCallback((message: string) => {
    const lower = message.toLowerCase();
    const isError = lower.includes("failed") || 
                    lower.includes("error") || 
                    lower.includes("offline") || 
                    lower.includes("invalid") || 
                    lower.includes("required") ||
                    lower.includes("please connect") ||
                    lower.includes("cannot be empty");
    
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    setToast({ message: message.replace(/\n/g, " "), type: isError ? "error" : "success" });
    
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 4500);
  }, []);

  // Load saved pools (hybrid: Supabase + localStorage fallback)
  useEffect(() => {
    if (!mounted) return;

    const loadPools = async () => {
      let localList: Array<{ address: string; name: string }> = [];
      try {
        const saved = localStorage.getItem("arc_treasury_pools");
        if (saved) {
          localList = JSON.parse(saved);
        }
      } catch (err) {}

      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (hasSupabase && address) {
        try {
          const { data, error } = await supabase
            .from("treasury_pools")
            .select("address, name")
            .eq("admin_address", address.toLowerCase());
          
          if (!error && data) {
            // Merge local and cloud data, preferring cloud data
            const cloudMap = new Map(data.map((p: any) => [p.address.toLowerCase(), p.name]));
            const localMap = new Map(localList.map((p: any) => [p.address.toLowerCase(), p.name]));
            
            // Add all cloud pools
            const mergedList = data.map((p: any) => ({ address: p.address, name: p.name }));
            
            // Add local pools that aren't in cloud yet (migration helper)
            for (const [addr, name] of localMap.entries()) {
              if (!cloudMap.has(addr)) {
                mergedList.push({ address: addr, name });
                void (async () => {
                  try {
                    await supabase.from("treasury_pools").upsert({
                      address: addr,
                      name: name,
                      admin_address: address.toLowerCase(),
                    });
                  } catch (_) {}
                })();
              }
            }
            
            setSavedPools(mergedList);
            localStorage.setItem("arc_treasury_pools", JSON.stringify(mergedList));
            return;
          }
        } catch (err) {
          console.warn("Supabase loading failed or table does not exist. Falling back to local storage.", err);
        }
      }
      
      // Fallback to local list only
      setSavedPools(localList);
    };

    loadPools();
  }, [mounted, address]);

  // Save a treasury pool (hybrid)
  const savePool = async (addr: string, name: string) => {
    const cleanAddr = addr.trim();
    const cleanName = name.trim() || "Unnamed Pool";
    
    // Save to local storage first
    try {
      const saved = localStorage.getItem("arc_treasury_pools");
      let list = saved ? JSON.parse(saved) : [];
      list = list.filter((p: any) => p.address.toLowerCase() !== cleanAddr.toLowerCase());
      list.push({ address: cleanAddr, name: cleanName });
      localStorage.setItem("arc_treasury_pools", JSON.stringify(list));
      setSavedPools(list);
    } catch (err) {}

    // Save to Supabase if connected
    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (hasSupabase && address) {
      try {
        await supabase.from("treasury_pools").upsert({
          address: cleanAddr.toLowerCase(),
          name: cleanName,
          admin_address: address.toLowerCase(),
        });
      } catch (err) {
        console.error("Failed to save pool to Supabase:", err);
      }
    }
  };

  // Delete a treasury pool (hybrid)
  const deletePool = async (addr: string) => {
    // Delete from local storage
    try {
      const saved = localStorage.getItem("arc_treasury_pools");
      let list = saved ? JSON.parse(saved) : [];
      list = list.filter((p: any) => p.address.toLowerCase() !== addr.toLowerCase());
      localStorage.setItem("arc_treasury_pools", JSON.stringify(list));
      setSavedPools(list);
    } catch (err) {}

    // Delete from Supabase
    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (hasSupabase && address) {
      try {
        await supabase.from("treasury_pools").delete().eq("address", addr.toLowerCase());
      } catch (err) {
        console.error("Failed to delete pool from Supabase:", err);
      }
    }
  };

  // Rename a treasury pool (hybrid)
  const renamePool = async (addr: string, currentName: string) => {
    const newName = window.prompt("Rename Pool:", currentName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      alert("Pool name cannot be empty!");
      return;
    }
    await savePool(addr, trimmed);
  };

  const handleDeploy = async () => {
    if (!isConnected) {
      alert("Please connect your wallet first!");
      return;
    }
    if (DEPLOYED_FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000") {
      alert("Factory address is not configured yet! Please set NEXT_PUBLIC_FACTORY_ADDRESS in the .env file.");
      return;
    }

    setIsDeploying(true);
    setTxPendingMessage("Requesting deployment transaction…");
    try {
      const hash = await writeContract(
        DEPLOYED_FACTORY_ADDRESS,
        factoryAbi,
        "deployTreasury",
        [USDC_ADDRESS]
      );

      setTxPendingMessage("Broadcasting & waiting for deployment confirmation…");
      const receipt = await waitForReceipt(publicClient, hash);

      if (receipt.status !== "success") {
        throw new Error("Factory deployment transaction reverted!");
      }

      // Decode transaction logs to find the TreasuryDeployed event
      let deployedAddress = "";
      const TREASURY_DEPLOYED_TOPIC = "0xbd2160b42ab1d57c5d6ae2bcf609970a551df554f5ac20bacac4e80143c33f45";

      for (const log of receipt.logs || []) {
        if (log.topics && log.topics.length >= 2) {
          const topic0 = log.topics[0]?.toLowerCase();
          if (
            topic0 === TREASURY_DEPLOYED_TOPIC ||
            log.address?.toLowerCase() === DEPLOYED_FACTORY_ADDRESS.toLowerCase()
          ) {
            deployedAddress = ("0x" + log.topics[1].slice(-40)) as `0x${string}`;
            break;
          }
        }
      }

      // If not in receipt logs (e.g. Circle SDK mock hash or empty logs array), scan factory logs
      if (!deployedAddress) {
        setTxPendingMessage("Searching blockchain for your new treasury address (waiting for confirmation)…");

        for (let attempt = 0; attempt < 15; attempt++) {
          try {
            const currentBlock = await publicClient.getBlockNumber();
            const startBlock = currentBlock > 100n ? currentBlock - 100n : 0n;

            const logs = await publicClient.getLogs({
              address: DEPLOYED_FACTORY_ADDRESS,
              fromBlock: startBlock,
            });

            if (logs && logs.length > 0) {
              const matchedLogs = logs.filter((log: any) => {
                if (!log.topics || log.topics.length < 2) return false;
                const topic0 = log.topics[0]?.toLowerCase();
                if (topic0 !== TREASURY_DEPLOYED_TOPIC) return false;
                if (!address || log.topics.length < 3) return true;
                const adminInLog = ("0x" + log.topics[2].slice(-40)).toLowerCase();
                return adminInLog === address.toLowerCase();
              });

              if (matchedLogs.length > 0) {
                const latestLog = matchedLogs[matchedLogs.length - 1];
                deployedAddress = ("0x" + latestLog.topics[1].slice(-40)) as `0x${string}`;
                break;
              }
            }
          } catch (eventErr) {
            console.error("Failed to query TreasuryDeployed events fallback:", eventErr);
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (!deployedAddress) {
        throw new Error("Could not extract deployed treasury address from receipt logs.");
      }

      confetti({ particleCount: 150, spread: 80 });
      setTxPendingMessage("Success! Redirecting to your new treasury dashboard…");
      
      savePool(deployedAddress, poolName || "Unnamed Pool");
      setPoolName("");

      // Short delay to let them see success
      setTimeout(() => {
        router.push(`/treasury/${deployedAddress}`);
      }, 1500);

    } catch (err: any) {
      console.error(err);
      alert(`Deployment failed: ${err.shortMessage || err.message || "Unknown error"}`);
      setIsDeploying(false);
      setTxPendingMessage(null);
    }
  };

  const handleOpenExisting = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAddress = existingAddress.trim();
    if (!cleanAddress.startsWith("0x") || cleanAddress.length !== 42) {
      alert("Please enter a valid EVM contract address starting with 0x!");
      return;
    }
    const cleanName = existingName.trim() || `Pool (${cleanAddress.slice(0, 6)}…${cleanAddress.slice(-4)})`;
    savePool(cleanAddress, cleanName);
    setExistingAddress("");
    setExistingName("");
    router.push(`/treasury/${cleanAddress}`);
  };

  if (!mounted) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
        <RefreshCw size={24} className="animate-spin" style={{ color: "var(--primary)" }} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "800px", margin: "30px auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: "36px" }}>

      {/* Global Transaction Overlay */}
      {txPendingMessage && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
          zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px",
        }}>
          <RefreshCw size={32} className="animate-spin" style={{ color: "var(--primary)" }} />
          <span style={{ fontWeight: 600, fontSize: "1.15rem" }}>{txPendingMessage}</span>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Do not close this page. Confirm the transaction in your wallet…</span>
        </div>
      )}

      {/* Hero Header */}
      <div className="glass-card responsive-card-padding" style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
        <div style={{ background: "rgba(255,255,255,0.06)", width: "70px", height: "70px", borderRadius: "18px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Landmark size={36} style={{ color: "var(--primary)" }} />
        </div>
        <h1 style={{ fontSize: "2.2rem", fontWeight: 800, margin: 0, background: "linear-gradient(135deg, #FFF 0%, #AAA 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Group Treasury Portal
        </h1>
        <p style={{ margin: 0, fontSize: "1rem", color: "var(--text-secondary)", maxWidth: "500px", lineHeight: 1.5 }}>
          Create shared multi-sig pools on the Arc Network. Set custom spending limits, draft expenditure proposals, and vote collectively.
        </p>
      </div>

      <div className="treasury-cards-grid">
        
        {/* Deploy New Treasury Card */}
        <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <PlusCircle size={20} style={{ color: "var(--primary)" }} />
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>Deploy New Pool</h2>
          </div>
          <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Deploy a fresh custom `ArcGroupTreasury` instance. Your wallet will automatically be set as the **Admin and First Member**, giving you rights to add others.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "auto" }}>
            <input 
              type="text" 
              placeholder="Pool Name (e.g. Operations Fund)" 
              value={poolName} 
              onChange={e => setPoolName(e.target.value)} 
              style={{ height: "45px", padding: "0 16px", borderRadius: "8px", border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.02)", fontSize: "0.88rem", outline: "none" }}
            />
            <button 
              onClick={handleDeploy} 
              disabled={isDeploying} 
              className="btn-primary" 
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", height: "45px", fontSize: "0.95rem" }}
            >
              {isDeploying ? "Deploying…" : "Deploy New Treasury"}
            </button>
          </div>
        </div>

        {/* Access Existing Treasury Card */}
        <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Settings size={20} style={{ color: "var(--primary)" }} />
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>Open Existing Pool</h2>
          </div>
          <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Already have a group pool address? Paste the deployed treasury contract address below to open its dashboard.
          </p>
          <form onSubmit={handleOpenExisting} style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "auto" }}>
            <input 
              type="text" 
              placeholder="Pool Name (Optional)" 
              value={existingName} 
              onChange={e => setExistingName(e.target.value)} 
              style={{ height: "45px", padding: "0 16px", borderRadius: "8px", border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.02)", fontSize: "0.88rem", outline: "none" }}
            />
            <input 
              type="text" 
              placeholder="0x contract address" 
              required 
              value={existingAddress} 
              onChange={e => setExistingAddress(e.target.value)} 
              style={{ height: "45px", padding: "0 16px", borderRadius: "8px", border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.02)", fontSize: "0.88rem", outline: "none" }}
            />
            <button 
              type="submit" 
              className="btn-secondary" 
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", height: "45px", gap: "6px", fontSize: "0.95rem" }}
            >
              Open Dashboard <ArrowRight size={16} />
            </button>
          </form>
        </div>

      </div>

      {/* Saved Pools List */}
      <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Landmark size={20} style={{ color: "var(--primary)" }} />
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>Your Saved Pools</h2>
        </div>
        
        {savedPools.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
            No saved treasury pools found. Deploy a pool or open an existing one to save it here.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {savedPools.map((pool) => (
              <div 
                key={pool.address} 
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "space-between", 
                  padding: "14px 18px", 
                  background: "rgba(255,255,255,0.01)", 
                  border: "1px solid var(--border-color)", 
                  borderRadius: "12px",
                  gap: "16px",
                  flexWrap: "wrap"
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.98rem", color: "#fff" }}>{pool.name}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    {pool.address}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <button 
                    onClick={() => router.push(`/treasury/${pool.address}`)} 
                    className="btn-secondary" 
                    style={{ padding: "6px 16px", height: "36px", fontSize: "0.85rem", margin: 0, display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    Open <ArrowRight size={14} />
                  </button>
                  <button 
                    onClick={() => renamePool(pool.address, pool.name)} 
                    style={{ 
                      background: "none", 
                      border: "none", 
                      color: "var(--primary)", 
                      cursor: "pointer", 
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      padding: "8px 12px",
                      borderRadius: "6px",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}
                  >
                    Rename
                  </button>
                  <button 
                    onClick={() => deletePool(pool.address)} 
                    style={{ 
                      background: "none", 
                      border: "none", 
                      color: "#f87171", 
                      cursor: "pointer", 
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      padding: "8px 12px",
                      borderRadius: "6px",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.1)"}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info footer */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center", fontSize: "0.8rem", color: "var(--text-muted)", padding: "10px" }}>
        <AlertCircle size={14} />
        <span>Make sure your wallet is connected to Arc Testnet (Chain ID 5042002).</span>
      </div>

      {/* Toast Notification Banner */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "32px",
            right: "32px",
            background: toast.type === "error" ? "rgba(239, 68, 68, 0.95)" : "rgba(16, 185, 129, 0.95)",
            color: "#ffffff",
            padding: "14px 22px",
            borderRadius: "12px",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(12px)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontWeight: 500,
            fontSize: "0.92rem",
            maxWidth: "420px",
            animation: "slideInToast 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <span>{toast.type === "error" ? "⚠️" : "✨"}</span>
          <span>{toast.message}</span>
        </div>
      )}

      <style>{`
        @keyframes slideInToast {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>

    </div>
  );
}
