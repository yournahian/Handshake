"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatUnits } from "viem";
import { escrowAbi, DEPLOYED_ESCROW_ADDRESS } from "@/lib/contracts";
import {
  User, Wallet, Landmark, ShieldCheck, History,
  TrendingUp, Award, Layers, ArrowUpRight, ArrowDownLeft,
  Activity, Settings, Plus, RefreshCw, Calendar, ExternalLink,
  ChevronLeft, ChevronRight
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useCircleWallet } from "@/components/CircleWalletContext";
import { publicClient } from "@/lib/publicClient";
import { supabase } from "@/lib/supabase";
import { CircleWalletCard } from "@/components/CircleWalletCard";
import { useThemedPrompt } from "@/components/ThemedDialog";
import confetti from "canvas-confetti";

interface UserEscrow {
  id: number;
  client: string;
  provider: string;
  description: string;
  budget: string;
  status: number;
  isPhysical?: boolean;
}

// Deduplicate by symbol — keep entry with largest amount, drop zeros
// (Circle may return the same token via multiple contract addresses)
function aggregateBalances(raw: any[]): any[] {
  const map = new Map<string, any>();
  for (const b of raw) {
    const key = b.token.symbol;
    const existing = map.get(key);
    const newAmt  = parseFloat(b.amount || "0");
    const prevAmt = existing ? parseFloat(existing.amount || "0") : -1;
    if (newAmt > prevAmt) map.set(key, b);
  }
  return Array.from(map.values()).filter(b => parseFloat(b.amount || "0") > 0);
}

export default function ProfilePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { address, isConnected } = useWallet();
  const { wallet, userToken, refreshWallet } = useCircleWallet();
  const { promptNode, showPrompt } = useThemedPrompt();

  const [username, setUsername] = useState("Guest User");
  const [savedPools, setSavedPools] = useState<Array<{ address: string; name: string }>>([]);
  const [userEscrows, setUserEscrows] = useState<UserEscrow[]>([]);
  const [historyTab, setHistoryTab] = useState<"otc" | "physical">("otc");
  const [loadingEscrows, setLoadingEscrows] = useState(false);
  const [balanceUSDC, setBalanceUSDC] = useState("0.00");
  const [allBalances, setAllBalances] = useState<any[]>([]);
  const [activeTokenIdx, setActiveTokenIdx] = useState(0);
  const [circleTransactions, setCircleTransactions] = useState<any[]>([]);
  const [savedSwaps, setSavedSwaps] = useState<Record<string, any>>({});
  const [savedEscrows, setSavedEscrows] = useState<Record<string, any>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingTx, setLoadingTx] = useState(false);

  // Features extensions states
  const [proposals, setProposals] = useState<any[]>([]);
  const [reputation, setReputation] = useState<any>(null);
  const [referralData, setReferralData] = useState<any>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [generatedApiKey, setGeneratedApiKey] = useState("");
  const [apiKeyLabel, setApiKeyLabel] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  const loadReputationAndReferrals = useCallback(async () => {
    if (!address) return;
    try {
      const repRes = await fetch(`/api/reputation?address=${address}`);
      if (repRes.ok) setReputation(await repRes.json());

      const refRes = await fetch(`/api/referrals?address=${address}`);
      if (refRes.ok) setReferralData(await refRes.json());

      const whRes = await fetch(`/api/webhooks?address=${address}`);
      if (whRes.ok) {
        const whData = await whRes.json();
        if (whData.webhook) {
          setWebhookUrl(whData.webhook.webhook_url);
        }
      }

      // Fetch escrow proposals
      const propRes = await fetch(`/api/proposals?address=${address}`);
      if (propRes.ok) {
        const propData = await propRes.json();
        setProposals(propData.proposals || []);
      }
    } catch {}
  }, [address]);

  useEffect(() => {
    if (address) {
      loadReputationAndReferrals();
    }
  }, [address, loadReputationAndReferrals]);

  // Load username (Supabase + localStorage fallback)
  const loadUsername = useCallback(async () => {
    if (!address) return;
    const localUser = localStorage.getItem(`arc_username_${address.toLowerCase()}`);
    if (localUser) {
      setUsername(localUser);
    }
    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (hasSupabase) {
      try {
        const { data, error } = await supabase
          .from("user_profiles")
          .select("username")
          .eq("address", address.toLowerCase())
          .single();
        if (!error && data?.username) {
          setUsername(data.username);
          localStorage.setItem(`arc_username_${address.toLowerCase()}`, data.username);
        }
      } catch (e) {}
    }
  }, [address]);

  // Edit Username
  const handleEditUsername = async () => {
    if (!address) return;
    const current = username === "Guest User" ? "" : username;

    const newName = await showPrompt({
      title: "Set your Username",
      description: "Choose a unique display name visible to other users.",
      defaultValue: current,
      placeholder: "e.g. yournahian",
      confirmLabel: "Save",
      validate: (v) => {
        if (!v || v.length < 2) return "Username must be at least 2 characters.";
        if (v.length > 30) return "Username must be 30 characters or less.";
        if (!/^[a-zA-Z0-9._-]+$/.test(v)) return "Only letters, numbers, dots, underscores and hyphens allowed.";
        return null;
      },
    });
    if (!newName) return;
    const trimmed = newName.trim();

    // Check for duplicates in Supabase
    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (hasSupabase) {
      try {
        const { data: existing } = await supabase
          .from("user_profiles")
          .select("address")
          .ilike("username", trimmed)
          .neq("address", address.toLowerCase())
          .maybeSingle();
        if (existing) {
          await showPrompt({
            title: "Username Taken",
            description: `"${trimmed}" is already in use by another user. Please choose a different username.`,
            confirmLabel: "OK",
            alertOnly: true,
          } as any);
          return;
        }
        await supabase.from("user_profiles").upsert({
          address: address.toLowerCase(),
          username: trimmed,
        });
      } catch (e) {
        console.error("Failed to save username to Supabase:", e);
      }
    }

    setUsername(trimmed);
    localStorage.setItem(`arc_username_${address.toLowerCase()}`, trimmed);
    confetti({ particleCount: 30 });
  };

  const handleSaveWebhook = async () => {
    if (!address || !webhookUrl) return;
    setSavingWebhook(true);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, webhookUrl })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.secret) setWebhookSecret(data.secret);
        showPrompt({ title: "Webhook Saved", description: "Webhook saved successfully!", alertOnly: true });
      } else {
        showPrompt({ title: "Failed to Save Webhook", description: data.error || "Failed to save webhook.", alertOnly: true });
      }
    } catch (e: any) {
      showPrompt({ title: "Error Saving Webhook", description: e.message, alertOnly: true });
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleGenerateApiKey = async () => {
    if (!address) return;
    setGeneratingKey(true);
    try {
      const res = await fetch("/api/v1", { // Note: public REST API POST generates key
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, label: apiKeyLabel || "My Key" })
      });
      const data = await res.json();
      if (res.ok) {
        setGeneratedApiKey(data.key);
        setApiKeyLabel("");
      } else {
        showPrompt({ title: "Failed to Generate Key", description: data.error || "Failed to generate key.", alertOnly: true });
      }
    } catch (e: any) {
      showPrompt({ title: "Error Generating Key", description: e.message, alertOnly: true });
    } finally {
      setGeneratingKey(false);
    }
  };


  // Load saved pools (hybrid: Supabase + localStorage fallback)
  const loadPools = useCallback(async () => {
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
          const cloudMap = new Map(data.map((p: any) => [p.address.toLowerCase(), p.name]));
          const localMap = new Map(localList.map((p: any) => [p.address.toLowerCase(), p.name]));
          
          const mergedList = data.map((p: any) => ({ address: p.address, name: p.name }));
          
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
        console.warn("Supabase loading failed. Falling back to local storage.", err);
      }
    }
    setSavedPools(localList);
  }, [address]);

  // Load personal escrows
  const fetchUserEscrows = useCallback(async () => {
    if (!publicClient || !address) return;
    setLoadingEscrows(true);
    try {
      const nextJobIdRaw = await publicClient.readContract({
        address: DEPLOYED_ESCROW_ADDRESS,
        abi: [
          { type: "function", name: "nextJobId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }
        ],
        functionName: "nextJobId",
      }) as bigint;

      const totalJobs = Number(nextJobIdRaw) - 1;
      const list: UserEscrow[] = [];
      const scanLimit = Math.max(1, totalJobs - 30); // scan last 30 jobs for speed

      for (let i = totalJobs; i >= scanLimit; i--) {
        try {
          const raw = await publicClient.readContract({
            address: DEPLOYED_ESCROW_ADDRESS,
            abi: escrowAbi,
            functionName: "jobs",
            args: [BigInt(i)],
          }) as readonly [any, string, string, any, string, bigint, any, number, any, any, string];

          const [, client, provider, , description, budgetRaw, , status, , , qrConfirmationHash] = raw;
          const isPhysical = qrConfirmationHash && qrConfirmationHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
          if (client.toLowerCase() === address.toLowerCase() || provider.toLowerCase() === address.toLowerCase()) {
            list.push({
              id: i,
              client,
              provider,
              description,
              budget: formatUnits(budgetRaw, 6),
              status,
              isPhysical: !!isPhysical
            });
          }
        } catch (e) {
          // skip
        }
      }
      setUserEscrows(list);
    } catch (err) {
      console.error("Error scanning user escrows:", err);
    } finally {
      setLoadingEscrows(false);
    }
  }, [address]);

  // Fetch Circle wallet balances & transactions
  const fetchCircleData = useCallback(async () => {
    if (!wallet?.id || !userToken) return;
    setLoadingTx(true);
    try {
      // 1. Fetch balance
      const balRes = await fetch(`/api/circle/balance?walletId=${wallet.id}&userToken=${encodeURIComponent(userToken)}`);
      const balData = await balRes.json();
      if (balRes.ok) {
        const balances = balData.tokenBalances || [];
        const aggregated = aggregateBalances(balances);
        setAllBalances(aggregated);
        const usdc = aggregated.find((b: any) => b.token?.symbol === "USDC");
        if (usdc) {
          setBalanceUSDC(parseFloat(usdc.amount).toFixed(2));
        }
      }

      // 2. Fetch transactions
      const txRes = await fetch(`/api/circle/transactions?walletId=${wallet.id}&userToken=${encodeURIComponent(userToken)}`);
      const txData = await txRes.json();
      if (txRes.ok) {
        setCircleTransactions(txData.transactions || []);
      }
    } catch (e) {
      console.error("Error fetching Circle wallet data:", e);
    } finally {
      setLoadingTx(false);
    }
  }, [wallet?.id, userToken]);

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await fetchUserEscrows();
      if (wallet?.id) {
        await refreshWallet();
        await fetchCircleData();
      }
      confetti({ particleCount: 50 });
    } catch (e) {
      console.error("Refresh failed:", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (mounted) {
      loadUsername();
      loadPools();
      fetchUserEscrows();
    }
  }, [mounted, address, loadUsername, loadPools, fetchUserEscrows]);

  // Fetch Circle transactions separately — runs once wallet.id is ready
  useEffect(() => {
    if (mounted && wallet?.id && userToken) {
      fetchCircleData();
    }
  }, [mounted, wallet?.id, userToken, fetchCircleData]);

  // Load saved swaps & escrows from localStorage to resolve amounts and symbols
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const savedSwapsRaw = localStorage.getItem("arc_saved_swaps");
        if (savedSwapsRaw) {
          setSavedSwaps(JSON.parse(savedSwapsRaw));
        }
        const savedEscrowsRaw = localStorage.getItem("arc_saved_escrows");
        if (savedEscrowsRaw) {
          setSavedEscrows(JSON.parse(savedEscrowsRaw));
        }
      } catch (err) {}
    }
  }, [circleTransactions]);

  // Saved pools helpers
  const savePool = async (addr: string, name: string) => {
    const cleanAddr = addr.trim();
    const cleanName = name.trim() || "Unnamed Pool";
    try {
      const saved = localStorage.getItem("arc_treasury_pools");
      let list = saved ? JSON.parse(saved) : [];
      list = list.filter((p: any) => p.address.toLowerCase() !== cleanAddr.toLowerCase());
      list.push({ address: cleanAddr, name: cleanName });
      localStorage.setItem("arc_treasury_pools", JSON.stringify(list));
      setSavedPools(list);
    } catch (err) {}

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

  const deletePool = async (addr: string) => {
    try {
      const saved = localStorage.getItem("arc_treasury_pools");
      let list = saved ? JSON.parse(saved) : [];
      list = list.filter((p: any) => p.address.toLowerCase() !== addr.toLowerCase());
      localStorage.setItem("arc_treasury_pools", JSON.stringify(list));
      setSavedPools(list);
    } catch (err) {}

    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (hasSupabase && address) {
      try {
        await supabase.from("treasury_pools").delete().eq("address", addr.toLowerCase());
      } catch (err) {
        console.error("Failed to delete pool from Supabase:", err);
      }
    }
  };

  const renamePool = async (addr: string, currentName: string) => {
    const newName = await showPrompt({
      title: "Rename Pool",
      defaultValue: currentName,
      placeholder: "Pool name",
      confirmLabel: "Rename",
      validate: (v) => (!v ? "Pool name cannot be empty." : null),
    });
    if (!newName) return;
    await savePool(addr, newName.trim());
  };

  // Stats calculation
  const totalEscrows = userEscrows.length;
  const activeEscrows = userEscrows.filter(e => [1, 2, 6].includes(e.status)).length;
  const totalPools = savedPools.length;

  const statuses = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired", "Disputed"];
  const badgeClass = (s: number) =>
    s === 3 ? "badge-success" : s === 6 ? "badge-danger" : s === 1 || s === 2 ? "badge-info" : "badge-warning";

  // Activity Graph Path Constructor (Sleek custom SVG area chart)
  const buildSvgPath = () => {
    const defaultPoints = [
      { x: 15, y: 120 }, { x: 125, y: 100 }, { x: 235, y: 110 },
      { x: 350, y: 80 }, { x: 465, y: 90 }, { x: 575, y: 40 },
      { x: 685, y: 20 }
    ];

    if (circleTransactions.length === 0) {
      const dLine = `M 15,120 C 150,110 200,40 350,80 C 450,120 550,20 685,20`;
      const dArea = `${dLine} L 685,150 L 15,150 Z`;
      return { line: dLine, area: dArea, isMock: true, points: defaultPoints };
    }

    const sortedTx = [...circleTransactions]
      .sort((a, b) => new Date(a.createDate).getTime() - new Date(b.createDate).getTime())
      .slice(-7);

    const points = sortedTx.map((tx, index) => {
      // Map x inside safe range [15, 685] to prevent clipping nodes on edges
      const x = 15 + (index / (Math.max(1, sortedTx.length - 1))) * 670;
      const amount = parseFloat(tx.amounts?.[0] || tx.amount || "0");
      const maxAmt = Math.max(...sortedTx.map(t => parseFloat(t.amounts?.[0] || t.amount || "1")));
      const y = 135 - ((amount / (maxAmt || 1)) * 105);
      return { x, y: isNaN(y) ? 80 : y, amount };
    });

    if (points.length === 1) {
      points.unshift({ x: 15, y: 120, amount: 0 });
      points.push({ x: 685, y: points[1].y, amount: points[1].amount });
    }

    let dLine = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpX1 = prev.x + (curr.x - prev.x) / 2;
      const cpY1 = prev.y;
      const cpX2 = prev.x + (curr.x - prev.x) / 2;
      const cpY2 = curr.y;
      dLine += ` C ${cpX1},${cpY1} ${cpX2},${cpY2} ${curr.x},${curr.y}`;
    }
    const dArea = `${dLine} L ${points[points.length - 1].x},150 L ${points[0].x},150 Z`;
    return { line: dLine, area: dArea, isMock: false, points };
  };

  const path = buildSvgPath();

  if (!mounted) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
        <RefreshCw size={24} className="animate-spin" style={{ color: "#818cf8" }} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "30px auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Themed dialog portal */}
      {promptNode}
      
      {/* Header Banner */}
      <div className="glass-card responsive-card-padding" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px", background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(168,85,247,0.03))", position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ background: "linear-gradient(135deg, #818cf8, #8b5cf6)", width: "60px", height: "60px", borderRadius: "16px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 20px rgba(99,102,241,0.25)" }}>
            <User size={30} style={{ color: "#fff" }} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: 0 }}>@{username}</h1>
              {reputation && (
                <span
                  title={`Reputation score: ${reputation.score}`}
                  style={{
                    background: "rgba(245,158,11,0.15)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: "20px",
                    padding: "2px 8px",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "#f59e0b",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  {reputation.tierIcon} {reputation.tier} ({reputation.score} pts)
                </span>
              )}
              {/* Verification Badges */}
              <div style={{ display: "flex", gap: "4px" }}>
                {wallet && (
                  <span title="Circle Wallet Verified" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px" }}>
                    ✓ CIRCLE
                  </span>
                )}
                {/* Check if in Telegram WebApp context */}
                {typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initData && (
                  <span title="Telegram Linked" style={{ background: "rgba(14,165,233,0.15)", color: "#0ea5e9", fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px" }}>
                    ✓ TELEGRAM
                  </span>
                )}
              </div>
              <button 
                onClick={handleEditUsername}
                style={{ 
                  background: "rgba(255,255,255,0.05)", 
                  border: "1px solid var(--border-color)", 
                  color: "var(--primary)", 
                  cursor: "pointer", 
                  fontSize: "0.75rem", 
                  fontWeight: 600, 
                  padding: "4px 8px",
                  borderRadius: "6px",
                  transition: "background 0.2s"
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
              >
                Edit Username
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "6px" }}>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Wallet: <code style={{ color: "var(--primary)", fontWeight: 600 }}>{address ? `${address.slice(0, 10)}…${address.slice(-8)}` : "Not connected"}</code>
              </p>
              {reputation && reputation.reviewCount > 0 && (
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                  ⭐ {reputation.avgRating} ({reputation.reviewCount} reviews)
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button 
            onClick={handleRefreshAll}
            className="btn-secondary" 
            style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0, height: "40px" }}
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} /> Refresh Data
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
        {/* Wallet Balance Card - Shows All Coins with Slider */}
        <div className="glass-card" style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Wallet Balance</span>
              {allBalances.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button
                    onClick={() => setActiveTokenIdx(prev => (prev === 0 ? allBalances.length - 1 : prev - 1))}
                    style={{ background: "rgba(255,255,255,0.06)", border: "none", color: "var(--text-primary)", borderRadius: "4px", padding: "2px 6px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    title="Previous Token"
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                    {activeTokenIdx + 1}/{allBalances.length}
                  </span>
                  <button
                    onClick={() => setActiveTokenIdx(prev => (prev === allBalances.length - 1 ? 0 : prev + 1))}
                    style={{ background: "rgba(255,255,255,0.06)", border: "none", color: "var(--text-primary)", borderRadius: "4px", padding: "2px 6px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    title="Next Token"
                  >
                    <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </div>

            {allBalances.length === 0 ? (
              <div style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: "4px", fontFamily: "Space Grotesk" }}>
                0.00 <span style={{ fontSize: "0.9rem", color: "var(--primary)", fontWeight: 700 }}>USDC</span>
              </div>
            ) : (() => {
              const idx = activeTokenIdx >= allBalances.length ? 0 : activeTokenIdx;
              const bal = allBalances[idx];
              if (!bal) return null;
              return (
                <div 
                  key={bal.token.symbol}
                  style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: "4px", fontFamily: "Space Grotesk", display: "flex", alignItems: "baseline", gap: "4px" }}
                >
                  {parseFloat(bal.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  <span style={{ fontSize: "0.9rem", color: "var(--primary)", fontWeight: 700 }}>{bal.token.symbol}</span>
                </div>
              );
            })()}
          </div>
          <div style={{ background: "rgba(99,102,241,0.08)", width: "46px", height: "46px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: "12px" }}>
            <Wallet size={20} style={{ color: "var(--primary)" }} />
          </div>
        </div>

        <div className="glass-card" style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Total Escrow Contracts</span>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: "4px", fontFamily: "Space Grotesk" }}>
              {totalEscrows} <span style={{ fontSize: "0.9rem", color: "var(--primary)" }}>Jobs</span>
            </div>
          </div>
          <div style={{ background: "rgba(16,185,129,0.08)", width: "46px", height: "46px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ShieldCheck size={20} style={{ color: "#10b981" }} />
          </div>
        </div>

        <div className="glass-card" style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Active Escrows</span>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: "4px", fontFamily: "Space Grotesk" }}>
              {activeEscrows} <span style={{ fontSize: "0.9rem", color: "#f59e0b" }}>Pending</span>
            </div>
          </div>
          <div style={{ background: "rgba(245,158,11,0.08)", width: "46px", height: "46px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TrendingUp size={20} style={{ color: "#f59e0b" }} />
          </div>
        </div>

        <div className="glass-card" style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Group Treasury Pools</span>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: "4px", fontFamily: "Space Grotesk" }}>
              {totalPools} <span style={{ fontSize: "0.9rem", color: "var(--primary)" }}>Pools</span>
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", width: "46px", height: "46px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Landmark size={20} style={{ color: "#a5b4fc" }} />
          </div>
        </div>

        {/* Fee Analytics */}
        <div className="glass-card" style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Fees Saved (Arc USDC gas)</span>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: "4px", fontFamily: "Space Grotesk", color: "#10b981" }}>
              {(totalEscrows * 0.12).toFixed(2)} <span style={{ fontSize: "0.9rem", color: "#10b981" }}>USDC</span>
            </div>
          </div>
          <div style={{ background: "rgba(16,185,129,0.08)", width: "46px", height: "46px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span>⚡</span>
          </div>
        </div>
      </div>

      {/* Main Split Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px", alignItems: "start" }}>
        
        {/* Left Column: Wallet Card & Recent Transactions Card */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* Wallet Card - fully integrated */}
          <CircleWalletCard onTransactionSuccess={fetchCircleData} />

          {/* Recent Transactions Card (Separate Grid block directly under the Wallet) */}
          <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <History size={18} style={{ color: "var(--primary)" }} />
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Recent Transactions</h3>
              </div>
              <button 
                onClick={fetchCircleData} 
                disabled={loadingTx}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontSize: "0.72rem" }}
              >
                <RefreshCw size={11} className={loadingTx ? "animate-spin" : ""} style={{ animation: loadingTx ? "spin 1s linear infinite" : "none" }} /> Refresh
              </button>
            </div>

            {loadingTx && circleTransactions.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                Loading transactions…
              </div>
            ) : circleTransactions.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: "0.82rem", border: "1px dashed rgba(255,255,255,0.06)", borderRadius: "8px" }}>
                No recent transactions found
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "250px", overflowY: "auto", paddingRight: "4px" }}>
                {circleTransactions.map((tx: any) => {
                  const statusColor = tx.state === "COMPLETE" ? "#10b981" : tx.state === "FAILED" ? "#ef4444" : "#f59e0b";
                  const date = new Date(tx.updateDate || tx.createDate).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                  
                  // Check if there is local metadata for this swap/escrow transaction hash
                  const txHashLower = tx.txHash?.toLowerCase();
                  const savedSwap = txHashLower ? savedSwaps[txHashLower] : null;
                  const savedEscrow = txHashLower ? savedEscrows[txHashLower] : null;

                  let displayLabel = "";
                  let displayAmount = "";
                  let isNegative = false;
                  
                  if (savedEscrow) {
                    const symbol = savedEscrow.symbol || "USDC";
                    displayLabel = savedEscrow.type === "fund"
                      ? `Fund Escrow #${savedEscrow.jobId}`
                      : `Escrow Call #${savedEscrow.jobId}`;
                    displayAmount = `${parseFloat(savedEscrow.amount).toFixed(2)} ${symbol}`;
                    isNegative = savedEscrow.type === "fund" || tx.transactionType === "OUTBOUND";
                  } else if (tx.isSwapTransaction) {
                    const inputSymbol = savedSwap?.inputSymbol || "USDC";
                    const outputSymbol = savedSwap?.outputSymbol || "EURC";
                    displayLabel = `Swap ${inputSymbol} to ${outputSymbol}`;
                    
                    if (tx.operation === "CONTRACT_EXECUTION") {
                      // Outbound swap execution leg
                      const amt = savedSwap ? parseFloat(savedSwap.inputAmount).toFixed(2) : "1.00";
                      displayAmount = `${amt} ${inputSymbol}`;
                      isNegative = true;
                    } else {
                      // Inbound swap receipt leg
                      const amt = savedSwap ? parseFloat(savedSwap.outputAmount).toFixed(2) : parseFloat(tx.amounts?.[0] || tx.amount || "0").toFixed(2);
                      displayAmount = `${amt} ${outputSymbol}`;
                      isNegative = false;
                    }
                  } else {
                    // Regular transfers or non-swap contract calls
                    isNegative = tx.transactionType === "OUTBOUND";
                    const symbol = tx.tokenSymbol || "USDC";
                    displayLabel = tx.contractLabel 
                      ? tx.contractLabel 
                      : (tx._kind === "transfer" 
                        ? (isNegative ? `Withdraw ${symbol}` : `Receive ${symbol}`)
                        : (isNegative ? `Send ${symbol}` : `Receive ${symbol}`));
                    const amt = parseFloat(tx.amounts?.[0] || tx.amount || "0.00").toFixed(2);
                    displayAmount = `${amt} ${symbol}`;
                  }

                  return (
                    <div 
                      key={tx.id} 
                      style={{ 
                        display: "flex", justifyContent: "space-between", alignItems: "center", 
                        padding: "10px 12px", background: "rgba(255,255,255,0.02)", 
                        borderRadius: "8px", border: "1px solid rgba(255,255,255,0.04)",
                        fontSize: "0.78rem"
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                          <span>{displayLabel}</span>
                          <span style={{ fontSize: "0.65rem", padding: "1px 5px", borderRadius: "4px", background: "rgba(255,255,255,0.05)", color: statusColor }}>
                            {tx.state}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{date}</span>
                          {tx.txHash && (
                            <a 
                              href={`https://testnet.arcscan.app/tx/${tx.txHash}`} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              style={{ display: "flex", alignItems: "center", gap: "2px", fontSize: "0.68rem", color: "var(--primary)", textDecoration: "none" }}
                            >
                              <span>{tx.txHash.slice(0, 6)}...{tx.txHash.slice(-4)}</span>
                              <ExternalLink size={10} />
                            </a>
                          )}
                          {tx.operation === "CONTRACT_EXECUTION" && tx.networkFee && parseFloat(tx.networkFee) > 0 && (
                            <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.3)" }}>
                              (Gas: {parseFloat(tx.networkFee).toFixed(4)} USDC)
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={{ fontWeight: 700, color: isNegative ? "#f43f5e" : "#10b981" }}>
                        {isNegative ? "-" : "+"}{displayAmount}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Transaction Volume Chart, Saved Pools & Escrow History */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* Activity Chart Card (Position shifted to Right) */}
          <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Activity size={18} style={{ color: "#818cf8" }} />
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Transaction Volume</h3>
              </div>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "3px 8px", borderRadius: "20px" }}>
                {path.isMock ? "Mock Waveform" : "Last 7 Tx"}
              </span>
            </div>
            
            {/* SVG Area Chart */}
            <div style={{ position: "relative", width: "100%", height: "150px", background: "rgba(0,0,0,0.2)", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--border-color)" }}>
              <svg viewBox="0 0 700 150" width="100%" height="100%" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#818cf8" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#818cf8" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                
                {/* Area under the line */}
                <path d={path.area} fill="url(#chartGrad)" />
                
                {/* Stroke line */}
                <path d={path.line} fill="none" stroke="#818cf8" strokeWidth="3.5" strokeLinecap="round" />
                
                {/* Render nodes for coordinates */}
                {path.points.map((pt, idx) => (
                  <g key={idx} className="chart-node" style={{ cursor: "pointer" }}>
                    <circle cx={pt.x} cy={pt.y} r="5.5" fill="#fff" stroke="#818cf8" strokeWidth="3" />
                    <circle cx={pt.x} cy={pt.y} r="10" fill="transparent" />
                    <title>{path.isMock ? `Point ${idx + 1}` : `${((pt as any).amount ?? 0).toFixed(2)} USDC`}</title>
                  </g>
                ))}
              </svg>
              
              {path.isMock && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(1px)" }}>
                  <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    No transactions yet. Activity curve will build here.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Saved Pools Card */}
          <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Landmark size={20} style={{ color: "var(--primary)" }} />
              <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>Your Saved Treasury Pools</h2>
            </div>
            
            {savedPools.length === 0 ? (
              <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>
                No saved pools found. Create or open pools to view them here.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {savedPools.map((pool) => (
                  <div 
                    key={pool.address} 
                    style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "space-between", 
                      padding: "12px 14px", 
                      background: "rgba(255,255,255,0.01)", 
                      border: "1px solid var(--border-color)", 
                      borderRadius: "10px",
                      gap: "12px",
                      flexWrap: "wrap"
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#fff" }}>{pool.name}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                        {pool.address.slice(0, 10)}…{pool.address.slice(-8)}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <button 
                        onClick={() => router.push(`/treasury/${pool.address}`)} 
                        className="btn-secondary" 
                        style={{ padding: "4px 10px", height: "30px", fontSize: "0.78rem", margin: 0, display: "flex", alignItems: "center", gap: "2px" }}
                      >
                        Open <ArrowUpRight size={12} />
                      </button>
                      <button 
                        onClick={() => renamePool(pool.address, pool.name)} 
                        style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, padding: "6px 8px" }}
                      >
                        Rename
                      </button>
                      <button 
                        onClick={() => deletePool(pool.address)} 
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, padding: "6px 8px" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Escrow Proposals Card */}
          {proposals.filter(p => p.status === "pending").length > 0 && (
            <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Layers size={20} style={{ color: "var(--primary)" }} />
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>Pending Escrow Proposals</h2>
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {proposals.filter(p => p.status === "pending").map((prop) => {
                  const isUserBuyer = prop.buyer_address.toLowerCase() === address?.toLowerCase();
                  return (
                    <div 
                      key={prop.id} 
                      style={{ 
                        padding: "14px", 
                        background: "rgba(255,255,255,0.01)", 
                        border: "1px solid var(--border-color)", 
                        borderRadius: "10px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px"
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <span style={{ fontSize: "0.65rem", fontWeight: 800, padding: "2px 6px", borderRadius: "999px", background: "rgba(168,85,247,0.15)", color: "#c084fc" }}>
                            {prop.escrow_type === "physical" ? "PHYSICAL MEETUP" : "DIGITAL WORK"}
                          </span>
                          <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#10b981" }}>{prop.budget} USDC</span>
                        </div>
                        <p style={{ margin: "4px 0", fontSize: "0.84rem", fontWeight: 600 }}>{prop.description}</p>
                        <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          {isUserBuyer ? `Proposed by Seller: ${prop.seller_address.slice(0, 8)}...${prop.seller_address.slice(-4)}` : `Proposed to Buyer: ${prop.buyer_address.slice(0, 8)}...${prop.buyer_address.slice(-4)}`}
                        </p>
                      </div>

                      {isUserBuyer && (
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            onClick={() => router.push(`/escrow/create?proposalId=${prop.id}`)}
                            className="btn-primary"
                            style={{ flex: 1, margin: 0, padding: "6px 12px", fontSize: "0.78rem", height: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            Approve & Create Escrow
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch("/api/proposals", {
                                  method: "PUT",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ proposalId: prop.id, status: "declined" })
                                });
                                if (res.ok) {
                                  showPrompt({ title: "Proposal Declined", alertOnly: true });
                                  loadReputationAndReferrals();
                                }
                              } catch (e) {}
                            }}
                            className="btn-secondary"
                            style={{ margin: 0, padding: "6px 12px", fontSize: "0.78rem", height: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Personal Escrows History Card */}
          <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <History size={20} style={{ color: "var(--primary)" }} />
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>Your Escrow History</h2>
              </div>
                      {/* Tabs */}
              <div style={{ display: "flex", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", borderRadius: "20px", padding: "2px" }}>
                <button
                  onClick={() => setHistoryTab("otc")}
                  style={{
                    background: historyTab === "otc" ? "hsl(var(--primary))" : "none",
                    color: historyTab === "otc" ? "#000" : "var(--text-secondary)",
                    border: "none",
                    borderRadius: "18px",
                    padding: "4px 12px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  OTC Escrow
                </button>
                <button
                  onClick={() => setHistoryTab("physical")}
                  style={{
                    background: historyTab === "physical" ? "hsl(var(--primary))" : "none",
                    color: historyTab === "physical" ? "#000" : "var(--text-secondary)",
                    border: "none",
                    borderRadius: "18px",
                    padding: "4px 12px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  Physical Meetup
                </button>
              </div>
            </div>

            {loadingEscrows ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)" }}>
                <RefreshCw size={16} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                Scanning escrow jobs…
              </div>
            ) : (() => {
              const filtered = userEscrows.filter(e => historyTab === "physical" ? e.isPhysical : !e.isPhysical);
              if (filtered.length === 0) {
                return (
                  <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>
                    No {historyTab === "physical" ? "physical meetup" : "OTC digital"} escrows found for this wallet.
                  </p>
                );
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {filtered.map((escrow) => (
                    <div 
                      key={escrow.id} 
                      onClick={() => router.push(escrow.isPhysical ? `/meetup/${escrow.id}` : `/escrow/${escrow.id}`)}
                      style={{ 
                        display: "flex", 
                        justifyContent: "space-between", 
                        alignItems: "center", 
                        padding: "12px 14px", 
                        background: "rgba(255,255,255,0.01)", 
                        border: "1px solid var(--border-color)", 
                        borderRadius: "10px",
                        cursor: "pointer",
                        transition: "border-color 0.2s"
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "var(--primary)"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-color)"}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "0.72rem", fontFamily: "Space Grotesk", color: "var(--text-muted)" }}>JOB #{escrow.id}</span>
                          <span className={`badge ${badgeClass(escrow.status)}`} style={{ transform: "scale(0.85)", transformOrigin: "left" }}>{statuses[escrow.status]}</span>
                        </div>
                        <h4 style={{ fontWeight: 600, fontSize: "0.88rem", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "240px" }}>
                          {escrow.description || "(no description)"}
                        </h4>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.88rem", fontFamily: "Space Grotesk" }}>
                          {escrow.budget} USDC
                        </span>
                        <ArrowUpRight size={14} style={{ color: "var(--text-muted)" }} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Referral Rewards Dashboard */}
          {referralData && (
            <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span>🎁</span>
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>Referral Rewards</h2>
              </div>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                Invite your friends to Handshake. You earn <b style={{ color: "#10b981" }}>0.50 USDC</b> when they complete their first digital or physical escrow.
              </p>
              
              <div style={{
                background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)",
                borderRadius: "10px", padding: "12px", display: "flex", gap: "12px", justifyContent: "space-around"
              }}>
                <div style={{ textAlign: "center" }}>
                  <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)" }}>Total Invites</span>
                  <span style={{ fontSize: "1.2rem", fontWeight: 700 }}>{referralData.total}</span>
                </div>
                <div style={{ borderLeft: "1px solid var(--border-color)" }} />
                <div style={{ textAlign: "center" }}>
                  <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)" }}>Completed</span>
                  <span style={{ fontSize: "1.2rem", fontWeight: 700, color: "#10b981" }}>{referralData.completed}</span>
                </div>
                <div style={{ borderLeft: "1px solid var(--border-color)" }} />
                <div style={{ textAlign: "center" }}>
                  <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)" }}>Total Earned</span>
                  <span style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--primary)" }}>{referralData.totalEarned} USDC</span>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "6px" }}>Your Referral Link</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    readOnly
                    value={referralData.referralLink}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", fontSize: "0.8rem" }}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(referralData.referralLink);
                      showPrompt({ title: "Copied!", description: "Referral link copied to clipboard.", alertOnly: true });
                    }}
                    className="btn-primary"
                    style={{ padding: "8px 12px", fontSize: "0.8rem" }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Developer Webhooks & API Panel */}
          <div className="glass-card responsive-card-padding" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Settings size={20} style={{ color: "var(--primary)" }} />
              <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>Developer Integrations</h2>
            </div>

            {/* Webhook setup */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>Webhook Notifications</span>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                Receive instant POST notifications to your server on escrow events.
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="https://yourserver.com/webhooks"
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", fontSize: "0.8rem" }}
                />
                <button
                  onClick={handleSaveWebhook}
                  disabled={savingWebhook}
                  className="btn-primary"
                  style={{ padding: "8px 16px", fontSize: "0.8rem" }}
                >
                  {savingWebhook ? "Saving..." : "Save"}
                </button>
              </div>
              {webhookSecret && (
                <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "8px", padding: "10px", fontSize: "0.78rem" }}>
                  <span style={{ display: "block", fontWeight: 600, color: "#10b981", marginBottom: "4px" }}>✓ Webhook Secret Generated:</span>
                  <code style={{ wordBreak: "break-all" }}>{webhookSecret}</code>
                </div>
              )}
            </div>

            <div style={{ borderBottom: "1px solid var(--border-color)" }} />

            {/* API Key generator */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>API Keys</span>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                Generate a key to query your escrows programmatically via the public REST API.
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Key label (e.g. Server)"
                  value={apiKeyLabel}
                  onChange={e => setApiKeyLabel(e.target.value)}
                  style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", fontSize: "0.8rem" }}
                />
                <button
                  onClick={handleGenerateApiKey}
                  disabled={generatingKey}
                  className="btn-secondary"
                  style={{ padding: "8px 16px", fontSize: "0.8rem" }}
                >
                  {generatingKey ? "Generating..." : "Generate Key"}
                </button>
              </div>
              {generatedApiKey && (
                <div style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: "8px", padding: "10px", fontSize: "0.78rem" }}>
                  <span style={{ display: "block", fontWeight: 600, color: "var(--primary)", marginBottom: "4px" }}>✓ API Key:</span>
                  <code style={{ wordBreak: "break-all" }}>{generatedApiKey}</code>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>

    </div>
  );
}
