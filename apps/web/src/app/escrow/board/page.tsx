"use client";

import React, { useEffect, useState } from "react";
import { publicClient } from "@/lib/publicClient";
import { escrowAbi, DEPLOYED_ESCROW_ADDRESS } from "@/lib/contracts";
import { formatUnits } from "viem";
import { Search, Filter, ExternalLink, ArrowRight, Shield, MapPin, Zap, Plus, RefreshCw, MessageSquare, Briefcase, Edit2, Trash2, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";

interface BoardEscrow {
  id: number;
  client: string;
  provider: string;
  description: string;
  budget: string;
  status: number;
  expiredAt: number;
  isPhysical: boolean;
}

interface OpenListing {
  id: string;
  title: string;
  description: string;
  budget: number;
  creator_address: string;
  contact_info: string;
  status: string;
  created_at: string;
  creator_role?: string;
  listing_type?: string;
}

export default function EscrowBoardPage() {
  const router = useRouter();
  const { isConnected, address } = useWallet();

  const [activeTab, setActiveTab] = useState<"onchain" | "p2p" | "my_listings">("onchain");
  const [escrows, setEscrows] = useState<BoardEscrow[]>([]);
  const [p2pListings, setP2pListings] = useState<OpenListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "digital" | "physical">("all");
  const [sortBy, setSortBy] = useState<"newest" | "budget_high" | "budget_low">("newest");

  // Post Listing Form Modal State
  const [showModal, setShowModal] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [postDesc, setPostDesc] = useState("");
  const [postBudget, setPostBudget] = useState("");
  const [postContact, setPostContact] = useState("");
  const [postRole, setPostRole] = useState<"buyer" | "seller">("buyer");
  const [postType, setPostType] = useState<"digital" | "physical">("digital");
  const [submitting, setSubmitting] = useState(false);

  // Edit Listing State
  const [editingListing, setEditingListing] = useState<OpenListing | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [editContact, setEditContact] = useState("");
  const [editRole, setEditRole] = useState<"buyer" | "seller">("buyer");
  const [editType, setEditType] = useState<"digital" | "physical">("digital");
  const [isUpdating, setIsUpdating] = useState(false);

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
                    lower.includes("please connect");
    
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    setToast({ message: message.replace(/\n/g, " "), type: isError ? "error" : "success" });
    
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 4500);
  }, []);

  const fetchOnChainJobs = async () => {
    try {
      const nextId = await publicClient.readContract({
        address: DEPLOYED_ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "nextJobId",
      }) as bigint;

      const total = Number(nextId);
      if (total <= 1) {
        setEscrows([]);
        return;
      }

      const results: BoardEscrow[] = [];
      const start = Math.max(1, total - 15);

      const calls = Array.from({ length: total - start + 1 }, (_, i) => {
        const currentId = BigInt(total - i);
        if (currentId < 1n) return Promise.resolve(null);

        return publicClient.readContract({
          address: DEPLOYED_ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: "jobs",
          args: [currentId],
        }).then((j: any) => ({
          id: Number(j[0]),
          client: j[1],
          provider: j[2],
          description: j[4],
          budget: formatUnits(j[5] || 0n, 6),
          expiredAt: Number(j[6] || 0n),
          status: Number(j[7] ?? 0),
          isPhysical: false,
        })).catch(() => null);
      });

      const jobs = (await Promise.all(calls)).filter(Boolean) as BoardEscrow[];
      results.push(...jobs.filter(j => j.status === 0));
      setEscrows(results);
    } catch (e) {
      console.error("Board load error:", e);
    }
  };

  const fetchP2pListings = async () => {
    try {
      const res = await fetch("/api/listings");
      if (res.ok) {
        const data = await res.json();
        setP2pListings(data.listings || []);
      }
    } catch (e) {
      console.error("Failed to load P2P listings:", e);
    }
  };

  const loadAllData = async () => {
    setLoading(true);
    await Promise.allSettled([fetchP2pListings(), fetchOnChainJobs()]);
    setLoading(false);
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const handlePostListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) {
      alert("Please connect your wallet first!");
      return;
    }
    if (!postTitle || !postDesc || !postBudget) {
      alert("Please fill in all required fields.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: postTitle,
          description: postDesc,
          budget: postBudget,
          creatorAddress: address,
          contactInfo: postContact,
          creatorRole: postRole,
          listingType: postType
        })
      });
      if (res.ok) {
        alert("P2P listing posted successfully!");
        setShowModal(false);
        setPostTitle("");
        setPostDesc("");
        setPostBudget("");
        setPostContact("");
        setPostRole("buyer");
        setPostType("digital");
        fetchP2pListings();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to post listing");
      }
    } catch (e: any) {
      alert("Error posting listing: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (listing: OpenListing) => {
    setEditingListing(listing);
    setEditTitle(listing.title);
    setEditDesc(listing.description.replace(/\[.*?\]/g, "").trim());
    setEditBudget(listing.budget.toString());
    setEditContact(listing.contact_info || "");
    setEditRole((listing.creator_role as any) || (listing.description.includes("[Role: seller]") ? "seller" : "buyer"));
    setEditType((listing.listing_type as any) || (listing.description.includes("[Physical Meetup]") ? "physical" : "digital"));
  };

  const handleUpdateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingListing || !address) return;
    setIsUpdating(true);
    try {
      const res = await fetch("/api/listings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingListing.id,
          title: editTitle,
          description: editDesc,
          budget: editBudget,
          creatorAddress: address,
          contactInfo: editContact,
          creatorRole: editRole,
          listingType: editType,
        })
      });
      if (res.ok) {
        alert("Listing updated successfully!");
        setEditingListing(null);
        fetchP2pListings();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update listing");
      }
    } catch (e: any) {
      alert("Error updating listing: " + e.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteListing = async (id: string) => {
    if (!address) return;
    if (!window.confirm("Are you sure you want to delete this listing?")) return;
    try {
      const res = await fetch(`/api/listings?id=${id}&creatorAddress=${address}`, {
        method: "DELETE"
      });
      if (res.ok) {
        alert("Listing deleted successfully!");
        setP2pListings(prev => prev.filter(item => item.id !== id));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete listing");
      }
    } catch (e: any) {
      alert("Error deleting listing: " + e.message);
    }
  };

  // Filter listings & escrows
  const cleanAddr = address ? address.toLowerCase() : "";
  const myListings = p2pListings.filter(l => cleanAddr && l.creator_address.toLowerCase() === cleanAddr);
  const publicP2pListings = p2pListings.filter(l => !cleanAddr || l.creator_address.toLowerCase() !== cleanAddr);

  const getFilteredItems = () => {
    if (activeTab === "onchain") {
      let list = [...escrows];
      if (search) {
        list = list.filter(e =>
          e.description?.toLowerCase().includes(search.toLowerCase()) ||
          e.client?.toLowerCase().includes(search.toLowerCase())
        );
      }
      if (typeFilter === "digital") list = list.filter(e => !e.isPhysical);
      if (typeFilter === "physical") list = list.filter(e => e.isPhysical);
      if (sortBy === "budget_high") list.sort((a, b) => parseFloat(b.budget) - parseFloat(a.budget));
      if (sortBy === "budget_low") list.sort((a, b) => parseFloat(a.budget) - parseFloat(b.budget));
      return list;
    } else if (activeTab === "p2p") {
      let list = [...publicP2pListings];
      if (search) {
        list = list.filter(e =>
          e.title.toLowerCase().includes(search.toLowerCase()) ||
          e.description.toLowerCase().includes(search.toLowerCase()) ||
          e.creator_address.toLowerCase().includes(search.toLowerCase())
        );
      }
      if (sortBy === "budget_high") list.sort((a, b) => b.budget - a.budget);
      if (sortBy === "budget_low") list.sort((a, b) => a.budget - b.budget);
      return list;
    } else {
      let list = [...myListings];
      if (search) {
        list = list.filter(e =>
          e.title.toLowerCase().includes(search.toLowerCase()) ||
          e.description.toLowerCase().includes(search.toLowerCase())
        );
      }
      if (sortBy === "budget_high") list.sort((a, b) => b.budget - a.budget);
      if (sortBy === "budget_low") list.sort((a, b) => a.budget - b.budget);
      return list;
    }
  };

  const filteredItems = getFilteredItems();

  return (
    <div style={{ maxWidth: "900px", margin: "30px auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: "24px" }}>
      
      {/* Header */}
      <div className="glass-card" style={{ padding: "24px", background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(168,85,247,0.03))", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: "1.6rem", fontWeight: 800 }}>
            🌐 Marketplace Board
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.85rem" }}>
            Browse open agreements or list custom freelance items directly on the dashboard
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary"
            style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}
          >
            <Plus size={15} /> Post a Job
          </button>
          <button
            onClick={loadAllData}
            className="btn-secondary"
            style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-color)", gap: "16px", overflowX: "auto" }}>
        <button
          onClick={() => setActiveTab("onchain")}
          style={{
            background: "none", border: "none", padding: "10px 4px", fontSize: "0.9rem", fontWeight: activeTab === "onchain" ? 700 : 500,
            color: activeTab === "onchain" ? "var(--primary)" : "var(--text-muted)", cursor: "pointer",
            borderBottom: activeTab === "onchain" ? "2px solid var(--primary)" : "none",
            whiteSpace: "nowrap"
          }}
        >
          On-Chain Negotiating ({escrows.length})
        </button>
        <button
          onClick={() => setActiveTab("p2p")}
          style={{
            background: "none", border: "none", padding: "10px 4px", fontSize: "0.9rem", fontWeight: activeTab === "p2p" ? 700 : 500,
            color: activeTab === "p2p" ? "var(--primary)" : "var(--text-muted)", cursor: "pointer",
            borderBottom: activeTab === "p2p" ? "2px solid var(--primary)" : "none",
            whiteSpace: "nowrap"
          }}
        >
          Freelance Marketplace ({publicP2pListings.length})
        </button>
        <button
          onClick={() => setActiveTab("my_listings")}
          style={{
            background: "none", border: "none", padding: "10px 4px", fontSize: "0.9rem", fontWeight: activeTab === "my_listings" ? 700 : 500,
            color: activeTab === "my_listings" ? "var(--primary)" : "var(--text-muted)", cursor: "pointer",
            borderBottom: activeTab === "my_listings" ? "2px solid var(--primary)" : "none",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: "6px"
          }}
        >
          <UserCheck size={14} /> My Listings ({myListings.length})
        </button>
      </div>

      {/* Filters */}
      <div className="board-filter-bar" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <div style={{
          flex: 1, minWidth: "200px",
          display: "flex", alignItems: "center", gap: "8px",
          background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)",
          borderRadius: "10px", padding: "0 12px",
        }}>
          <Search size={14} style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder={activeTab === "onchain" ? "Search by description or buyer..." : "Search title, description, or creator..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, background: "transparent", border: "none", color: "#f1f5f9", fontSize: "0.84rem", padding: "10px 0", outline: "none" }}
          />
        </div>
        {activeTab === "onchain" && (
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as any)}
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "#f1f5f9", padding: "0 12px", fontSize: "0.84rem", cursor: "pointer" }}
          >
            <option value="all">All Types</option>
            <option value="digital">Digital</option>
            <option value="physical">Physical</option>
          </select>
        )}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "#f1f5f9", padding: "0 12px", fontSize: "0.84rem", cursor: "pointer" }}
        >
          <option value="newest">Newest First</option>
          <option value="budget_high">Highest Budget</option>
          <option value="budget_low">Lowest Budget</option>
        </select>
      </div>

      {/* Grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card" style={{ padding: "20px", opacity: 0.5, animation: "pulse 1.5s infinite" }}>
              <div style={{ height: "14px", background: "rgba(255,255,255,0.08)", borderRadius: "6px", width: "60%", marginBottom: "8px" }} />
              <div style={{ height: "10px", background: "rgba(255,255,255,0.05)", borderRadius: "6px", width: "40%" }} />
            </div>
          ))
        ) : filteredItems.length === 0 ? (
          <div className="glass-card" style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
            <Shield size={36} style={{ opacity: 0.3, marginBottom: "12px" }} />
            <p style={{ margin: 0 }}>
              {activeTab === "my_listings" ? "You haven't posted any listings yet. Click 'Post a Job' above!" : "No items found matching your filters"}
            </p>
          </div>
        ) : activeTab === "onchain" ? (
          (filteredItems as BoardEscrow[]).map(e => (
            <div
              key={e.id}
              className="glass-card board-item-card"
              style={{ cursor: "pointer", transition: "border-color 0.2s" }}
              onClick={() => router.push(`/escrow/${e.id}`)}
              onMouseEnter={e => e.currentTarget.style.borderColor = "var(--primary)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-color)"}
            >
              <div style={{
                width: "42px", height: "42px", borderRadius: "12px", flexShrink: 0,
                background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.1))",
                border: "1px solid rgba(99,102,241,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#818cf8",
              }}>
                {e.isPhysical ? <MapPin size={18} /> : <Zap size={18} />}
              </div>

              <div className="board-item-body" style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>#{e.id}</span>
                  <span style={{
                    fontSize: "0.65rem", fontWeight: 700, padding: "2px 7px", borderRadius: "999px",
                    background: e.isPhysical ? "rgba(16,185,129,0.15)" : "rgba(99,102,241,0.15)",
                    color: e.isPhysical ? "#10b981" : "#818cf8",
                  }}>
                    {e.isPhysical ? "PHYSICAL" : "DIGITAL"}
                  </span>
                </div>
                <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.description || "(no description)"}
                </p>
                <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  Buyer: {e.client.slice(0, 8)}...{e.client.slice(-4)}
                </p>
              </div>

              <div className="board-item-actions">
                <div>
                  <div style={{ fontWeight: 800, fontSize: "1rem", color: "#10b981" }}>
                    {parseFloat(e.budget).toFixed(2)} USDC
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "2px" }}>Budget</div>
                </div>
                <ArrowRight size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              </div>
            </div>
          ))
        ) : activeTab === "my_listings" ? (
          (filteredItems as OpenListing[]).map(e => (
            <div
              key={e.id}
              className="glass-card board-item-card"
            >
              <div style={{
                width: "42px", height: "42px", borderRadius: "12px", flexShrink: 0,
                background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.15))",
                border: "1px solid rgba(99,102,241,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#a5b4fc",
              }}>
                <UserCheck size={18} />
              </div>

              <div className="board-item-body" style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{
                    fontSize: "0.62rem", fontWeight: 800, padding: "2px 6px", borderRadius: "999px",
                    background: e.creator_role === "seller" ? "rgba(168,85,247,0.15)" : "rgba(16,185,129,0.15)",
                    color: e.creator_role === "seller" ? "#c084fc" : "#10b981",
                  }}>
                    {e.creator_role === "seller" ? "YOUR SERVICE OFFER" : "YOUR JOB POST"}
                  </span>
                  <span style={{
                    fontSize: "0.62rem", fontWeight: 800, padding: "2px 6px", borderRadius: "999px",
                    background: e.listing_type === "physical" ? "rgba(245,158,11,0.15)" : "rgba(59,130,246,0.15)",
                    color: e.listing_type === "physical" ? "#f59e0b" : "#3b82f6",
                  }}>
                    {e.listing_type === "physical" ? "PHYSICAL / MEETUP" : "ONLINE / DIGITAL"}
                  </span>
                </div>
                <h3 style={{ margin: "0 0 4px", fontWeight: 700, fontSize: "0.95rem" }}>
                  {e.title}
                </h3>
                <p style={{ margin: "0 0 6px", fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                  {e.description.replace(/\[.*?\]/g, "").trim()}
                </p>
                {e.contact_info && (
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                    <MessageSquare size={11} style={{ color: "var(--primary)" }} /> Contact: {e.contact_info}
                  </div>
                )}
              </div>

              <div className="board-item-actions">
                <div>
                  <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#10b981" }}>
                    {parseFloat(e.budget.toString()).toFixed(2)} USDC
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Your Budget</div>
                </div>
                <div className="board-actions-btn-group" style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => openEditModal(e)}
                    className="btn-secondary"
                    style={{ padding: "4px 10px", fontSize: "0.75rem", margin: 0, display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    <Edit2 size={12} /> Edit
                  </button>
                  <button
                    onClick={() => handleDeleteListing(e.id)}
                    className="btn-secondary"
                    style={{ padding: "4px 10px", fontSize: "0.75rem", margin: 0, display: "flex", alignItems: "center", gap: "4px", borderColor: "rgba(239,68,68,0.3)", color: "var(--danger)" }}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          (filteredItems as OpenListing[]).map(e => (
            <div
              key={e.id}
              className="glass-card board-item-card"
            >
              <div style={{
                width: "42px", height: "42px", borderRadius: "12px", flexShrink: 0,
                background: e.creator_role === "seller"
                  ? "linear-gradient(135deg, rgba(168,85,247,0.15), rgba(99,102,241,0.1))"
                  : "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(99,102,241,0.1))",
                border: e.creator_role === "seller"
                  ? "1px solid rgba(168,85,247,0.2)"
                  : "1px solid rgba(16,185,129,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: e.creator_role === "seller" ? "#c084fc" : "#10b981",
              }}>
                <Briefcase size={18} />
              </div>

              <div className="board-item-body" style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{
                    fontSize: "0.62rem", fontWeight: 800, padding: "2px 6px", borderRadius: "999px",
                    background: e.creator_role === "seller" ? "rgba(168,85,247,0.15)" : "rgba(16,185,129,0.15)",
                    color: e.creator_role === "seller" ? "#c084fc" : "#10b981",
                  }}>
                    {e.creator_role === "seller" ? "OFFERING SERVICE" : "LOOKING TO HIRE"}
                  </span>
                  <span style={{
                    fontSize: "0.62rem", fontWeight: 800, padding: "2px 6px", borderRadius: "999px",
                    background: e.listing_type === "physical" ? "rgba(245,158,11,0.15)" : "rgba(59,130,246,0.15)",
                    color: e.listing_type === "physical" ? "#f59e0b" : "#3b82f6",
                  }}>
                    {e.listing_type === "physical" ? "PHYSICAL / MEETUP" : "ONLINE / DIGITAL"}
                  </span>
                </div>
                <h3 style={{ margin: "0 0 4px", fontWeight: 700, fontSize: "0.95rem" }}>
                  {e.title}
                </h3>
                <p style={{ margin: "0 0 6px", fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                  {e.description.replace(/\[.*?\]/g, "").trim()}
                </p>
                <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  <span>Creator: {e.creator_address.slice(0, 8)}...{e.creator_address.slice(-4)}</span>
                  {e.contact_info && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "var(--primary)" }}>
                      <MessageSquare size={11} /> Contact: {e.contact_info}
                    </span>
                  )}
                </div>
              </div>

              <div className="board-item-actions">
                <div>
                  <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#10b981" }}>
                    {parseFloat(e.budget.toString()).toFixed(2)} USDC
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Budget</div>
                </div>
                <button
                  onClick={() => {
                    const isPhysical = e.listing_type === "physical" || e.description?.includes("[Physical Meetup]");
                    const targetType = isPhysical ? "physical" : "digital";
                    const cleanDesc = e.title + (e.description ? ` - ${e.description.replace(/\[.*?\]/g, "").trim()}` : "");
                    const isSellerListing = e.creator_role === "seller" || e.description?.includes("[Role: seller]");
                    const counterpartyParam = isSellerListing ? `provider=${e.creator_address}&role=buyer` : `buyer=${e.creator_address}&role=seller`;
                    
                    router.push(`/escrow/create?description=${encodeURIComponent(cleanDesc)}&amount=${e.budget}&type=${targetType}&${counterpartyParam}`);
                  }}
                  className="btn-primary"
                  style={{ padding: "6px 14px", fontSize: "0.8rem", margin: 0, display: "flex", alignItems: "center", gap: "4px" }}
                >
                  {e.creator_role === "seller" ? "Hire / Create Escrow" : "Accept / Create Escrow"} <ArrowRight size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit listing Modal */}
      {editingListing && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px"
        }}>
          <form onSubmit={handleUpdateListing} className="glass-card" style={{ width: "100%", maxWidth: "480px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>✏️ Edit P2P Listing</h2>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
              Update your listing details on the marketplace board.
            </p>

            <div style={{ display: "flex", gap: "10px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Listing Type</label>
                <select
                  value={editRole}
                  onChange={e => setEditRole(e.target.value as any)}
                  style={{ padding: "8px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", color: "#f1f5f9", fontSize: "0.82rem" }}
                >
                  <option value="buyer">Looking to Hire (Buyer)</option>
                  <option value="seller">Offering Services (Seller)</option>
                </select>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Work Location</label>
                <select
                  value={editType}
                  onChange={e => setEditType(e.target.value as any)}
                  style={{ padding: "8px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", color: "#f1f5f9", fontSize: "0.82rem" }}
                >
                  <option value="digital">Online / Digital</option>
                  <option value="physical">In-Person / Physical</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Title *</label>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                required
                style={{ padding: "10px", borderRadius: "8px", fontSize: "0.85rem" }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Description *</label>
              <textarea
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                required
                rows={3}
                style={{ padding: "10px", borderRadius: "8px", fontSize: "0.85rem", resize: "none" }}
              />
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Budget (USDC) *</label>
                <input
                  type="number"
                  value={editBudget}
                  onChange={e => setEditBudget(e.target.value)}
                  required
                  min="1"
                  style={{ padding: "10px", borderRadius: "8px", fontSize: "0.85rem" }}
                />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Telegram or Email</label>
                <input
                  type="text"
                  placeholder="@handle"
                  value={editContact}
                  onChange={e => setEditContact(e.target.value)}
                  style={{ padding: "10px", borderRadius: "8px", fontSize: "0.85rem" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <button
                type="submit"
                disabled={isUpdating}
                className="btn-primary"
                style={{ flex: 1, margin: 0, height: "38px" }}
              >
                {isUpdating ? "Saving..." : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => setEditingListing(null)}
                className="btn-secondary"
                style={{ margin: 0, height: "38px" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Post listing Modal */}
      {showModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px"
        }}>
          <form onSubmit={handlePostListing} className="glass-card" style={{ width: "100%", maxWidth: "480px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Post a Freelance P2P Listing</h2>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
              This will add an open listing to the freelance marketplace board for other users to view and connect.
            </p>

            <div style={{ display: "flex", gap: "10px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Listing Type</label>
                <select
                  value={postRole}
                  onChange={e => setPostRole(e.target.value as any)}
                  style={{ padding: "8px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", color: "#f1f5f9", fontSize: "0.82rem" }}
                >
                  <option value="buyer">Looking to Hire (Buyer)</option>
                  <option value="seller">Offering Services (Seller)</option>
                </select>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Work Location</label>
                <select
                  value={postType}
                  onChange={e => setPostType(e.target.value as any)}
                  style={{ padding: "8px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", color: "#f1f5f9", fontSize: "0.82rem" }}
                >
                  <option value="digital">Online / Digital</option>
                  <option value="physical">In-Person / Physical</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Title *</label>
              <input
                type="text"
                placeholder="e.g. Website Front-End Redesign"
                value={postTitle}
                onChange={e => setPostTitle(e.target.value)}
                required
                style={{ padding: "10px", borderRadius: "8px", fontSize: "0.85rem" }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Description *</label>
              <textarea
                placeholder="Describe the deliverables, timeline, and expectations..."
                value={postDesc}
                onChange={e => setPostDesc(e.target.value)}
                required
                rows={3}
                style={{ padding: "10px", borderRadius: "8px", fontSize: "0.85rem", resize: "none" }}
              />
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Budget (USDC) *</label>
                <input
                  type="number"
                  placeholder="50"
                  value={postBudget}
                  onChange={e => setPostBudget(e.target.value)}
                  required
                  min="1"
                  style={{ padding: "10px", borderRadius: "8px", fontSize: "0.85rem" }}
                />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Telegram or Email</label>
                <input
                  type="text"
                  placeholder="@handle"
                  value={postContact}
                  onChange={e => setPostContact(e.target.value)}
                  style={{ padding: "10px", borderRadius: "8px", fontSize: "0.85rem" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary"
                style={{ flex: 1, margin: 0, height: "38px" }}
              >
                {submitting ? "Posting..." : "Post Job"}
              </button>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="btn-secondary"
                style={{ margin: 0, height: "38px" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

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
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 0.25; }
        }
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
