"use client";

/**
 * CircleWalletCard
 * ─────────────────────────────────────────────────────────────────────────────
 * Displays the user's Circle-managed wallet details and lets them initiate
 * a USDC withdrawal to any external wallet (e.g. MetaMask).
 */

import React, { useState, useEffect, useCallback } from "react";
import { useCircleWallet } from "./CircleWalletContext";
import {
  Wallet, Copy, CheckCircle, Loader2, ArrowUpRight,
  RefreshCw, ExternalLink, AlertCircle, ShieldCheck,
  ArrowDownLeft,
} from "lucide-react";
import { CctpBridgeCard } from "./CctpBridgeCard";
import { useThemedPrompt } from "./ThemedDialog";

export function CircleWalletCard({ onTransactionSuccess }: { onTransactionSuccess?: () => void }) {
  const {
    status, wallet, errorMessage, email, userToken,
    setupWallet, refreshWallet, transferOut,
    executeContractCall, executeChallenge,
    loginWithEmail, logout,
  } = useCircleWallet();

  const { promptNode, showPrompt } = useThemedPrompt();

  // Automatically trigger PIN setup modal when user login succeeds but no wallet exists yet
  useEffect(() => {
    if (status === "setup_required") {
      setupWallet();
    }
  }, [status, setupWallet]);

  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"none" | "withdraw" | "bridge" | "swap">("none");
  const [destAddress, setDestAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [txStatus, setTxStatus] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [txError, setTxError] = useState("");

  // Swap State Extensions
  const [swapAmount, setSwapAmount] = useState("");
  const [fromToken, setFromToken] = useState("");
  const [toToken, setToToken] = useState("");
  const [swapQuote, setSwapQuote] = useState<any>(null);
  const [estimating, setEstimating] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapStatusMsg, setSwapStatusMsg] = useState("Confirming Swap...");

  const [emailInput, setEmailInput] = useState("");
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);
  const [usdcTokenId, setUsdcTokenId] = useState<string | undefined>(undefined);
  // Removed transactions state and history logic (moved to Profile page)

  // Fetch token balances to configure token transfer & show swap balances
  const [balances, setBalances] = useState<any[]>([]);

  const fetchCircleBalances = useCallback(() => {
    if (!wallet?.id || !userToken) return;
    fetch(`/api/circle/balance?walletId=${wallet.id}&userToken=${encodeURIComponent(userToken)}`)
      .then(res => res.json())
      .then(data => {
        const list = data.tokenBalances || [];
        setBalances(list);
        const usdc = list.find((b: any) => b.token?.symbol === "USDC");
        if (usdc) {
          setUsdcTokenId(usdc.token.id);
        }
      })
      .catch(err => console.error("Error fetching balances:", err));
  }, [wallet?.id, userToken]);

  useEffect(() => {
    fetchCircleBalances();
  }, [fetchCircleBalances]);

  // Dynamically initialize swap select values based on available token balances
  useEffect(() => {
    if (balances.length > 0) {
      const usdc = balances.find(b => b.token?.symbol === "USDC");
      const usdt = balances.find(b => b.token?.symbol === "USDT" || b.token?.symbol === "cirUSDT");
      const other = balances.find(b => b.token?.symbol !== "USDC");

      if (usdc && !toToken) {
        setToToken(usdc.token.tokenAddress || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
      }
      if (usdt && !fromToken) {
        setFromToken(usdt.token.tokenAddress || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
      } else if (other && !fromToken) {
        setFromToken(other.token.tokenAddress || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
      } else if (balances[0] && !fromToken) {
        setFromToken(balances[0].token.tokenAddress || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
      }
    }
  }, [balances, fromToken, toToken]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) {
      showPrompt({ title: "Please enter a valid email address.", alertOnly: true });
      return;
    }
    setIsSubmittingEmail(true);
    try {
      await loginWithEmail(emailInput);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingEmail(false);
    }
  };

  const copyAddress = () => {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWithdraw = async () => {
    if (!destAddress || !amount) return;
    setTxStatus("pending");
    setTxError("");
    try {
      // Circle W3S API expects the amount as a human-readable decimal string (e.g. "5.00"), not base units.
      await transferOut({ destinationAddress: destAddress, amount, tokenId: usdcTokenId });
      setTxStatus("done");
      setAmount("");
      setDestAddress("");
      // Refresh wallet after 2 seconds to let the chain update balance
      setTimeout(() => {
        refreshWallet();
        onTransactionSuccess?.();
      }, 2000);
      setTimeout(() => { setTxStatus("idle"); setActiveTab("none"); }, 3000);
    } catch (err: any) {
      setTxStatus("error");
      setTxError(err.message || "Transfer failed");
    }
  };

  if (status === "idle") {
    return (
      <>
        <div className="glass-card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
            <Wallet size={20} style={{ color: "#818cf8" }} />
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>Circle Smart Wallet</h3>
          </div>
          <p style={{ margin: "0 0 16px", fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
            Use a secure, PIN-protected MPC smart wallet. No MetaMask or extensions required.
          </p>
          <form onSubmit={handleEmailSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <input
              type="email"
              placeholder="Enter your email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              style={{
                padding: "10px 14px",
                borderRadius: "10px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#e2e8f0",
                fontSize: "0.85rem",
                outline: "none",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
            <button
              type="submit"
              disabled={isSubmittingEmail}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "11px 20px",
                borderRadius: "10px",
                border: "none",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff",
                fontWeight: 600,
                fontSize: "0.85rem",
                cursor: "pointer",
                transition: "opacity 0.2s",
              }}
            >
              {isSubmittingEmail ? (
                <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
              ) : (
                "Sign In / Sign Up"
              )}
            </button>
          </form>
        </div>
        {promptNode}
      </>
    );
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="glass-card" style={{ padding: "24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Loader2 size={20} style={{ color: "#818cf8", animation: "spin 1s linear infinite" }} />
        <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>Initializing your wallet…</span>
        <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      </div>
    );
  }

  // ── Setup required ───────────────────────────────────────────────────────
  if (status === "setup_required" || (status === "error" && !wallet)) {
    return (
      <div className="glass-card" style={{ padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <Wallet size={20} style={{ color: "#818cf8" }} />
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>Circle Smart Wallet</h3>
        </div>
        {errorMessage && (
          <div style={{
            display: "flex", gap: "8px", alignItems: "flex-start",
            padding: "10px", background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px",
            marginBottom: "14px",
          }}>
            <AlertCircle size={15} style={{ color: "#ef4444", flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#ef4444" }}>{errorMessage}</p>
          </div>
        )}
        <p style={{ margin: "0 0 16px", fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
          Create your secure wallet to participate in treasury without needing MetaMask.
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={setupWallet}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "10px 18px", borderRadius: "10px", border: "none",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "#fff", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer",
            }}
          >
            Create Wallet
          </button>
          {email && (
            <button
              onClick={logout}
              style={{
                padding: "10px 18px", borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "transparent", color: "var(--text-muted)",
                fontWeight: 600, fontSize: "0.85rem", cursor: "pointer",
              }}
            >
              Cancel / Change Email
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Ready ────────────────────────────────────────────────────────────────
  if (!wallet) return null;

  const handleSwapEstimate = async () => {
    if (!swapAmount || parseFloat(swapAmount) <= 0 || !fromToken || !toToken) return;
    setEstimating(true);
    setSwapQuote(null);
    try {
      const res = await fetch("/api/circle/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "estimate",
          fromToken,
          toToken,
          amount: swapAmount,
          chain: "Arc_Testnet"
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSwapQuote(data.quote);
      } else {
        showPrompt({ title: "Estimation Failed", description: data.error || "Failed to estimate swap.", alertOnly: true });
      }
    } catch (e: any) {
      showPrompt({ title: "Estimation Error", description: e.message, alertOnly: true });
    } finally {
      setEstimating(false);
    }
  };

  // Helper: submit one transaction to Circle and execute the PIN challenge
  const executeCircleChallenge = (sdk: any, challengeId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      sdk.executeChallenge(challengeId, (err: any, result: any) => {
        if (err) reject(new Error("Challenge rejected: " + (err.message || err)));
        else resolve(result);
      });
    });
  };



  const pollTransactionComplete = async (txId: string): Promise<boolean> => {
    if (!txId) {
      console.warn("[pollTransactionComplete] No txId provided for polling");
      return false;
    }
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        const res = await fetch(`/api/circle/transactions/${txId}?userToken=${encodeURIComponent(userToken!)}`);
        if (res.ok) {
          const data = await res.json();
          const state = data?.transaction?.state;
          if (state === "COMPLETE") return true;
          if (state === "FAILED" || state === "CANCELLED") return false;
        }
      } catch (e) {
        console.warn("Polling error:", e);
      }
    }
    return false;
  };

  const handleExecuteSwap = async () => {
    if (!swapQuote || swapping || !fromToken || !toToken) return;
    setSwapping(true);
    setSwapStatusMsg("Preparing Swap...");
    try {
      // Step 1: Build swap transactions (approval + execute) via SwapKit
      const res = await fetch("/api/circle/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "build",
          fromToken,
          toToken,
          amount: swapAmount,
          walletAddress: wallet.address,
          chain: "Arc_Testnet"
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to build swap transaction");

      // Step 2: Execute token approval if required (USDC allowance for Circle Adapter)
      if (data.approvalTx) {
        setSwapStatusMsg("Approval Required...");
        const approvalRes = await fetch("/api/circle/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userToken,
            walletId: wallet.id,
            contractAddress: data.approvalTx.to,
            abiFunctionSignature: "approve(address,uint256)",
            abiParameters: [{ type: "callData", value: data.approvalTx.data }]
          })
        });
        const approvalData = await approvalRes.json();
        if (!approvalRes.ok) throw new Error(approvalData.error || "Approval transaction failed");

        if (approvalData.challengeId) {
          await executeChallenge(approvalData.challengeId);
          
          // Wait for approval transaction to be completely mined on-chain
          setSwapStatusMsg("Confirming Approval...");
          if (approvalData.txId) {
            const approvalConfirmed = await pollTransactionComplete(approvalData.txId);
            if (!approvalConfirmed) {
              throw new Error("Token approval failed or timed out on-chain. Please try again.");
            }
          } else {
            console.warn("No approval txId returned from execute. Waiting 5s fallback...");
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          
          // Give the Circle W3S iframe/modal 1.5 seconds to fully unmount and clean up
          setSwapStatusMsg("Approval Confirmed!");
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      // Step 3: Execute the swap transaction
      if (!data.swapTx) throw new Error("Swap transaction data not returned from server");

      setSwapStatusMsg("Executing Swap...");
      const swapRes = await fetch("/api/circle/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken,
          walletId: wallet.id,
          contractAddress: data.swapTx.to,
          abiFunctionSignature: "execute(bytes)",
          abiParameters: [{ type: "callData", value: data.swapTx.data }]
        })
      });
      const swapExecData = await swapRes.json();
      if (!swapRes.ok) throw new Error(swapExecData.error || "Swap execution failed");

      if (swapExecData.challengeId) {
        await executeChallenge(swapExecData.challengeId);
        
        // Wait for swap transaction to be completely mined on-chain
        setSwapStatusMsg("Confirming Swap...");
        let finalTxHash = "";
        
        if (swapExecData.txId) {
          const swapConfirmed = await pollTransactionComplete(swapExecData.txId);
          if (!swapConfirmed) {
            throw new Error("Swap transaction failed or timed out on-chain.");
          }
          
          // Fetch transaction details to get the actual txHash
          try {
            const txRes = await fetch(`/api/circle/transactions/${swapExecData.txId}?userToken=${encodeURIComponent(userToken!)}`);
            if (txRes.ok) {
              const txData = await txRes.json();
              finalTxHash = txData?.transaction?.txHash;
            }
          } catch (e) {
            console.warn("Failed to fetch swap txHash for metadata storage:", e);
          }
        } else {
          console.warn("No swap txId returned from execute. Waiting 5s fallback...");
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Save swap details to localStorage if txHash was found
        if (finalTxHash && finalTxHash !== "0x") {
          try {
            const savedSwaps = JSON.parse(localStorage.getItem("arc_saved_swaps") || "{}");
            savedSwaps[finalTxHash.toLowerCase()] = {
              inputAmount: swapAmount,
              inputSymbol: getFriendlySymbol(fromToken),
              outputAmount: parseFloat(swapQuote.estimatedOutput?.amount || "0").toFixed(4),
              outputSymbol: getFriendlySymbol(toToken),
              timestamp: Date.now()
            };
            localStorage.setItem("arc_saved_swaps", JSON.stringify(savedSwaps));
          } catch (err) {
            console.warn("Failed to save swap details to localStorage:", err);
          }
        }

        showPrompt({ title: "✅ Swap complete and confirmed on-chain!", alertOnly: true });
        setSwapQuote(null);
        setSwapAmount("");
        setActiveTab("none");
        refreshWallet();
        onTransactionSuccess?.();
      } else {
        showPrompt({ title: "Swap prepared.", description: "Please check Circle SDK installation.", alertOnly: true });
      }
    } catch (e: any) {
      showPrompt({ title: "Swap execution error", description: e.message, alertOnly: true });
    } finally {
      setSwapping(false);
      setSwapStatusMsg("Confirming Swap...");
    }
  };


  if (activeTab === "bridge") {
    return (
      <CctpBridgeCard 
        onBack={() => setActiveTab("none")} 
        circleWalletAddress={wallet?.address}
        executeContractCall={executeContractCall}
        onComplete={fetchCircleBalances}
      />
    );
  }

  const uniqueBalances = balances.filter((b, index, self) => 
    self.findIndex(t => {
      const addrA = t.token?.tokenAddress || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      const addrB = b.token?.tokenAddress || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      return addrA.toLowerCase() === addrB.toLowerCase();
    }) === index
  );

  const allAvailableTokens = [
    { symbol: "USDC (Native)", tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", name: "USD Coin (Native)" },
    { symbol: "USDC", tokenAddress: "0x3600000000000000000000000000000000000000", name: "USD Coin" },
    { symbol: "EURC", tokenAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", name: "EUR Coin" },
    { symbol: "USYC", tokenAddress: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C", name: "Short Duration Yield Coin" },
    ...uniqueBalances.map(b => ({
      symbol: b.token.symbol,
      tokenAddress: b.token.tokenAddress || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      name: b.token.name
    }))
  ].filter((t, index, self) =>
    self.findIndex(x => x.tokenAddress.toLowerCase() === t.tokenAddress.toLowerCase()) === index
  );

  const getBalanceAmount = (addr: string) => {
    if (!addr) return "0.00";
    return balances.find(b => {
      const bAddr = b.token?.tokenAddress || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      return bAddr.toLowerCase() === addr.toLowerCase();
    })?.amount || "0.00";
  };

  const getFriendlySymbol = (addr: string) => {
    if (!addr) return "";
    return allAvailableTokens.find(t => t.tokenAddress.toLowerCase() === addr.toLowerCase())?.symbol || addr;
  };

  const shortAddress = `${wallet.address.slice(0, 8)}…${wallet.address.slice(-6)}`;

  return (
    <div className="glass-card" style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "10px",
            background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))",
            border: "1px solid rgba(99,102,241,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <ShieldCheck size={18} style={{ color: "#818cf8" }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>Circle Smart Wallet</h3>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "2px", flexWrap: "wrap" }}>
              <span style={{
                fontSize: "0.7rem", padding: "2px 8px", borderRadius: "20px",
                background: "rgba(16,185,129,0.1)", color: "#10b981",
                border: "1px solid rgba(16,185,129,0.2)", fontWeight: 600,
                flexShrink: 0
              }}>
                {wallet.state === "LIVE" ? "● Active" : wallet.state}
              </span>
              {email && (
                <span 
                  style={{ 
                    fontSize: "0.75rem", 
                    color: "var(--text-muted)",
                    maxWidth: "150px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "inline-block"
                  }} 
                  title={email}
                >
                  ({email})
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <button
            onClick={refreshWallet}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", padding: "4px" }}
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          {email && (
            <button
              onClick={logout}
              style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                color: "#ef4444",
                cursor: "pointer",
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: "6px",
                transition: "all 0.2s",
                whiteSpace: "nowrap",
                flexShrink: 0
              }}
              title="Log Out"
            >
              Log Out
            </button>
          )}
        </div>
      </div>

      {/* Address */}
      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "10px",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "16px",
      }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "4px" }}>Wallet Address</div>
          <code style={{ fontSize: "0.85rem", color: "#e2e8f0" }}>{shortAddress}</code>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={copyAddress}
            title="Copy address"
            style={{ background: "none", border: "none", color: copied ? "#10b981" : "var(--text-muted)", cursor: "pointer" }}
          >
            {copied ? <CheckCircle size={15} /> : <Copy size={15} />}
          </button>
          <a
            href={`https://testnet.arcscan.app/address/${wallet.address}`}
            target="_blank"
            rel="noreferrer"
            title="View on explorer"
            style={{ color: "var(--text-muted)", display: "flex" }}
          >
            <ExternalLink size={15} />
          </a>
        </div>
      </div>

      {/* Network */}
      <div style={{
        fontSize: "0.78rem", color: "var(--text-muted)",
        marginBottom: "16px",
        display: "flex", gap: "6px", alignItems: "center",
      }}>
        <span style={{
          width: "8px", height: "8px", borderRadius: "50%",
          background: "#10b981", display: "inline-block",
        }} />
        Arc Testnet · MPC secured
      </div>
      {/* Tabs: Withdraw | Deposit (Bridge) | Swap */}
      {(() => {
        const tab = activeTab as "none" | "withdraw" | "bridge" | "swap";
        return (
          <div style={{ display: "flex", gap: "8px", marginBottom: tab === "none" ? "0px" : "12px" }}>
            <button
              onClick={() => { setActiveTab(tab === "withdraw" ? "none" : "withdraw"); }}
              style={{
                flex: 1, padding: "8px", borderRadius: "8px", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600,
                background: tab === "withdraw" ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                color:      tab === "withdraw" ? "#818cf8" : "var(--text-muted,#888)",
                border: "1px solid rgba(255,255,255,0.05)"
              }}
            >
              Withdraw
            </button>
            <button
              onClick={() => { setActiveTab(tab === "bridge" ? "none" : "bridge"); }}
              style={{
                flex: 1, padding: "8px", borderRadius: "8px", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600,
                background: tab === "bridge" ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                color:      tab === "bridge" ? "#818cf8" : "var(--text-muted,#888)",
                border: "1px solid rgba(255,255,255,0.05)"
              }}
            >
              Deposit (Bridge)
            </button>
            <button
              onClick={() => { setActiveTab(tab === "swap" ? "none" : "swap"); }}
              style={{
                flex: 1, padding: "8px", borderRadius: "8px", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600,
                background: tab === "swap" ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                color:      tab === "swap" ? "#818cf8" : "var(--text-muted,#888)",
                border: "1px solid rgba(255,255,255,0.05)"
              }}
            >
              Swap
            </button>
          </div>
        );
      })()}

      {activeTab === "withdraw" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)", fontWeight: 600 }}>
            Withdraw USDC to MetaMask or any address:
          </p>
          <input
            type="text"
            placeholder="Destination address (0x…)"
            value={destAddress}
            onChange={e => setDestAddress(e.target.value)}
            style={{
              padding: "10px 14px", borderRadius: "8px",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#e2e8f0", fontSize: "0.85rem", outline: "none", width: "100%", boxSizing: "border-box",
            }}
          />
          <input
            type="number"
            placeholder="Amount (USDC)"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            min="0"
            step="0.01"
            style={{
              padding: "10px 14px", borderRadius: "8px",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#e2e8f0", fontSize: "0.85rem", outline: "none", width: "100%", boxSizing: "border-box",
            }}
          />

          {txStatus === "error" && (
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#ef4444" }}>{txError}</p>
          )}
          {txStatus === "done" && (
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#10b981" }}>✓ Transfer submitted!</p>
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleWithdraw}
              disabled={txStatus === "pending" || !destAddress || !amount}
              style={{
                flex: 1, padding: "10px", borderRadius: "8px", border: "none",
                background: txStatus === "pending" ? "rgba(99,102,241,0.3)" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff", fontWeight: 600, fontSize: "0.85rem",
                cursor: txStatus === "pending" ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              }}
            >
              {txStatus === "pending" ? (
                <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Confirming…</>
              ) : "Send"}
            </button>
            <button
              onClick={() => { setActiveTab("none"); setTxStatus("idle"); }}
              style={{
                padding: "10px 16px", borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "transparent", color: "var(--text-muted)",
                cursor: "pointer", fontSize: "0.85rem",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {activeTab === "swap" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)", fontWeight: 600 }}>
            Instant Token Swap (Arc Testnet)
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px" }}>
            {/* Sell Block */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 500 }}>
                <span>Sell</span>
                <span>Balance: {getBalanceAmount(fromToken)}</span>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "10px 14px" }}>
                <input
                  type="number"
                  placeholder="0.00"
                  value={swapAmount}
                  onChange={e => { setSwapAmount(e.target.value); setSwapQuote(null); }}
                  min="0"
                  step="0.01"
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    color: "#f1f5f9",
                    fontSize: "1.2rem",
                    fontWeight: 700,
                    outline: "none",
                    padding: "4px 0",
                    width: "100%",
                  }}
                  className="hide-spinners"
                />
                <select
                  value={fromToken}
                  onChange={e => { setFromToken(e.target.value); setSwapQuote(null); }}
                  style={{
                    width: "auto",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "#e2e8f0",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  {allAvailableTokens.map((t, idx) => (
                    <option key={idx} value={t.tokenAddress} style={{ background: "#0d0d0d", color: "#fff" }}>
                      {t.symbol}
                    </option>
                  ))}
                  {allAvailableTokens.length === 0 && (
                    <option value="" style={{ background: "#0d0d0d", color: "#fff" }}>Loading...</option>
                  )}
                </select>
              </div>
            </div>

            {/* Divider Arrow */}
            <div style={{ display: "flex", justifyContent: "center", margin: "-6px 0" }}>
              <div style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "50%",
                width: "28px",
                height: "28px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                fontSize: "0.8rem",
                fontWeight: 700
              }}>
                ↓
              </div>
            </div>

            {/* Buy Block */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 500 }}>
                <span>Buy (Estimated)</span>
                <span>Balance: {getBalanceAmount(toToken)}</span>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "10px 14px" }}>
                <input
                  type="text"
                  placeholder="0.00"
                  value={swapQuote ? parseFloat(swapQuote.estimatedOutput?.amount || "0").toFixed(4) : ""}
                  readOnly
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    color: swapQuote ? "#10b981" : "#a3a3a3",
                    fontSize: "1.2rem",
                    fontWeight: 700,
                    outline: "none",
                    padding: "4px 0",
                    width: "100%",
                  }}
                />
                <select
                  value={toToken}
                  onChange={e => { setToToken(e.target.value); setSwapQuote(null); }}
                  style={{
                    width: "auto",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "#e2e8f0",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  {allAvailableTokens.map((t, idx) => (
                    <option key={idx} value={t.tokenAddress} style={{ background: "#0d0d0d", color: "#fff" }}>
                      {t.symbol}
                    </option>
                  ))}
                  {allAvailableTokens.length === 0 && (
                    <option value="" style={{ background: "#0d0d0d", color: "#fff" }}>Loading...</option>
                  )}
                </select>
              </div>
            </div>
          </div>

          <button
            onClick={handleSwapEstimate}
            disabled={estimating || !swapAmount}
            style={{
              padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)", color: "#f1f5f9", fontWeight: 600, fontSize: "0.82rem",
              cursor: estimating ? "default" : "pointer",
            }}
          >
            {estimating ? "Estimating Rate..." : "Get Swap Estimate"}
          </button>

          {swapQuote && (
            <div style={{
              background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)",
              borderRadius: "8px", padding: "12px", fontSize: "0.82rem", display: "flex", flexDirection: "column", gap: "6px"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>You Receive:</span>
                <span style={{ fontWeight: 700, color: "#10b981" }}>
                  {parseFloat(swapQuote.estimatedOutput?.amount || "0").toFixed(4)} {getFriendlySymbol(toToken)}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Gas Fee estimate:</span>
                <span>
                  {parseFloat(swapQuote.fees?.[0]?.amount || "0").toFixed(4)} {swapQuote.fees?.[0]?.token || "USDC"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Exchange Rate:</span>
                <span>
                  1 {getFriendlySymbol(fromToken)} ≈ {
                    (parseFloat(swapQuote.estimatedOutput?.amount || "0") / parseFloat(swapAmount || "1")).toFixed(4)
                  } {getFriendlySymbol(toToken)}
                </span>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <button
              onClick={handleExecuteSwap}
              disabled={swapping || !swapQuote}
              style={{
                flex: 1, padding: "10px", borderRadius: "8px", border: "none",
                background: swapping || !swapQuote ? "rgba(99,102,241,0.3)" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff", fontWeight: 600, fontSize: "0.85rem",
                cursor: swapping || !swapQuote ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              }}
            >
              {swapping ? (
                <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> {swapStatusMsg}</>
              ) : "Confirm Swap"}
            </button>
            <button
              onClick={() => { setActiveTab("none"); setSwapQuote(null); setSwapAmount(""); }}
              style={{
                padding: "10px 16px", borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "transparent", color: "var(--text-muted)",
                cursor: "pointer", fontSize: "0.85rem",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}


      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      {promptNode}
    </div>
  );
}
