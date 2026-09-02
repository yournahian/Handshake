"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  MessageSquare, 
  DollarSign, 
  Send, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  ArrowRight, 
  Sparkles, 
  Tag, 
  User, 
  ShieldCheck, 
  RefreshCw,
  TrendingUp,
  AlertCircle
} from "lucide-react";
import { supabase } from "@/lib/supabase";

export interface EscrowMessage {
  id: string;
  job_id: number;
  sender: string;
  sender_role: "buyer" | "seller" | "evaluator" | "system" | "user";
  type: "text" | "bid" | "accept_bid" | "decline_bid" | "agreement";
  text: string;
  bid_amount: number | null;
  status: "pending" | "accepted" | "declined" | "superseded";
  created_at: string;
}

interface EscrowChatBiddingProps {
  jobId: number;
  clientAddress: string;
  providerAddress: string;
  evaluatorAddress?: string;
  currentAddress?: string;
  jobStatus: number; // 0=Open, 1=Funded, etc.
  onChainBudget: string; // e.g. "100.0" or "0"
  onCommitBudget?: (amount: string) => Promise<void>;
  isCommittingBudget?: boolean;
}

export function EscrowChatBidding({
  jobId,
  clientAddress,
  providerAddress,
  evaluatorAddress,
  currentAddress,
  jobStatus,
  onChainBudget,
  onCommitBudget,
  isCommittingBudget = false,
}: EscrowChatBiddingProps) {
  const [messages, setMessages] = useState<EscrowMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [bidAmountInput, setBidAmountInput] = useState("");
  const [showBidModal, setShowBidModal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [agreedBid, setAgreedBid] = useState<EscrowMessage | null>(null);

  const chatFeedRef = useRef<HTMLDivElement | null>(null);
  const initialLoadedRef = useRef(false);
  const prevCountRef = useRef(0);
  const activeAddr = currentAddress?.toLowerCase() || "";
  const isClient = activeAddr === clientAddress.toLowerCase();
  const isProvider = activeAddr === providerAddress.toLowerCase();

  const userRole: "buyer" | "seller" | "evaluator" | "user" = isClient 
    ? "buyer" 
    : isProvider 
    ? "seller" 
    : activeAddr === evaluatorAddress?.toLowerCase() 
    ? "evaluator" 
    : "user";

  // Scroll ONLY the internal chat feed container — never hijack browser window scroll
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTo({
        top: chatFeedRef.current.scrollHeight,
        behavior,
      });
    }
  }, []);

  // Fetch messages from API / Supabase
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/escrow/${jobId}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages && Array.isArray(data.messages)) {
          setMessages(data.messages);
          // Check for accepted bid
          const accepted = data.messages.find(
            (m: EscrowMessage) => m.type === "bid" && m.status === "accepted"
          );
          if (accepted) {
            setAgreedBid(accepted);
          }
        }
      }
    } catch (err) {
      console.warn("Failed to fetch escrow messages:", err);
    }
  }, [jobId]);

  // Initial load and Realtime listener
  useEffect(() => {
    fetchMessages();

    // Set up Supabase Realtime channel
    const hasSupabase =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    let channel: any = null;
    if (hasSupabase) {
      channel = supabase
        .channel(`escrow_chat_${jobId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "escrow_messages",
            filter: `job_id=eq.${jobId}`,
          },
          () => {
            fetchMessages();
          }
        )
        .subscribe();
    }

    // Polling fallback every 4 seconds
    const interval = setInterval(fetchMessages, 4000);

    return () => {
      clearInterval(interval);
      if (channel) supabase.removeChannel(channel);
    };
  }, [jobId, fetchMessages]);

  useEffect(() => {
    if (!initialLoadedRef.current && messages.length > 0) {
      scrollToBottom("auto");
      initialLoadedRef.current = true;
    } else if (messages.length > prevCountRef.current) {
      // If user is already looking at bottom of chat, keep it pinned to bottom
      if (chatFeedRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = chatFeedRef.current;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
        if (isNearBottom) {
          scrollToBottom("smooth");
        }
      }
    }
    prevCountRef.current = messages.length;
  }, [messages, scrollToBottom]);

  // Send a regular text message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isSending) return;

    const textToSend = inputText.trim();
    setInputText("");
    setIsSending(true);

    try {
      const payload = {
        sender: activeAddr || "anonymous",
        senderRole: userRole,
        type: "text",
        text: textToSend,
      };

      const res = await fetch(`/api/escrow/${jobId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setMessages((prev) => [...prev, data.message]);
          setTimeout(() => scrollToBottom("smooth"), 50);
        }
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setIsSending(false);
      fetchMessages();
    }
  };

  // Submit a new off-chain bid
  const handleSubmitBid = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const amountNum = parseFloat(bidAmountInput);
    if (isNaN(amountNum) || amountNum <= 0 || isSending) return;

    setIsSending(true);
    try {
      const payload = {
        sender: activeAddr || "anonymous",
        senderRole: userRole,
        type: "bid",
        text: `${userRole === "buyer" ? "Buyer" : userRole === "seller" ? "Seller" : "User"} proposed a bid of ${amountNum} USDC`,
        bidAmount: amountNum,
        status: "pending",
      };

      const res = await fetch(`/api/escrow/${jobId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setBidAmountInput("");
        setShowBidModal(false);
        await fetchMessages();
        setTimeout(() => scrollToBottom("smooth"), 50);
      }
    } catch (err) {
      console.error("Failed to submit bid:", err);
    } finally {
      setIsSending(false);
    }
  };

  // Accept a bid
  const handleAcceptBid = async (bid: EscrowMessage) => {
    if (isSending || !bid.bid_amount) return;
    setIsSending(true);
    try {
      // 1. Post accept action to API
      const payload = {
        sender: activeAddr || "anonymous",
        senderRole: userRole,
        type: "accept_bid",
        text: `🤝 ${userRole === "buyer" ? "Buyer" : "Seller"} accepted the bid of ${bid.bid_amount} USDC!`,
        bidAmount: bid.bid_amount,
        actionBidId: bid.id,
      };

      await fetch(`/api/escrow/${jobId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setAgreedBid(bid);
      fetchMessages();
    } catch (err) {
      console.error("Failed to accept bid:", err);
    } finally {
      setIsSending(false);
    }
  };

  // Decline a bid
  const handleDeclineBid = async (bid: EscrowMessage) => {
    if (isSending) return;
    setIsSending(true);
    try {
      const payload = {
        sender: activeAddr || "anonymous",
        senderRole: userRole,
        type: "decline_bid",
        text: `❌ ${userRole === "buyer" ? "Buyer" : "Seller"} declined the offer of ${bid.bid_amount} USDC.`,
        actionBidId: bid.id,
      };

      await fetch(`/api/escrow/${jobId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      fetchMessages();
    } catch (err) {
      console.error("Failed to decline bid:", err);
    } finally {
      setIsSending(false);
    }
  };

  // Find the latest active bid
  const latestPendingBid = [...messages]
    .reverse()
    .find((m) => m.type === "bid" && m.status === "pending");

  // Format sender label
  const getSenderBadge = (msg: EscrowMessage) => {
    if (msg.sender_role === "buyer") {
      return (
        <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#818cf8", background: "rgba(99,102,241,0.15)", padding: "2px 6px", borderRadius: "4px" }}>
          👤 Buyer
        </span>
      );
    }
    if (msg.sender_role === "seller") {
      return (
        <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.15)", padding: "2px 6px", borderRadius: "4px" }}>
          💼 Seller
        </span>
      );
    }
    if (msg.sender_role === "evaluator") {
      return (
        <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.15)", padding: "2px 6px", borderRadius: "4px" }}>
          🤖 AI Arbitrator
        </span>
      );
    }
    return (
      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: "4px" }}>
        User
      </span>
    );
  };

  return (
    <div style={{
      background: "rgba(255, 255, 255, 0.02)",
      border: "1px solid var(--border-color)",
      borderRadius: "16px",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      height: "560px",
      boxShadow: "0 12px 36px rgba(0,0,0,0.25)"
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        background: "rgba(255,255,255,0.03)",
        borderBottom: "1px solid var(--border-color)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "10px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "10px",
            background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <MessageSquare size={18} style={{ color: "#818cf8" }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "6px" }}>
              Live Negotiation & Bids
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Bids & terms are off-chain. Price is submitted on-chain only once agreed.
            </div>
          </div>
        </div>

        {/* Quick Propose Bid Trigger */}
        {jobStatus === 0 && (
          <button
            onClick={() => setShowBidModal((prev) => !prev)}
            className="btn-secondary"
            style={{
              padding: "6px 12px",
              fontSize: "0.8rem",
              gap: "6px",
              borderColor: "rgba(99,102,241,0.3)",
              background: "rgba(99,102,241,0.08)",
              color: "#a5b4fc"
            }}
          >
            <DollarSign size={14} />
            {showBidModal ? "Close Bid Form" : "Propose Price / Bid"}
          </button>
        )}
      </div>

      {/* Agreed Price Action Banner */}
      {agreedBid && jobStatus === 0 && (
        <div style={{
          background: "linear-gradient(90deg, rgba(16,185,129,0.12), rgba(99,102,241,0.12))",
          borderBottom: "1px solid rgba(16,185,129,0.3)",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <CheckCircle2 size={18} style={{ color: "#10b981" }} />
            <div>
              <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#10b981" }}>
                Price Agreed: {agreedBid.bid_amount} USDC
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                {parseFloat(onChainBudget) === agreedBid.bid_amount
                  ? "✓ Agreed price is confirmed on-chain. Ready for buyer funding."
                  : isProvider
                  ? "Click below to commit this agreed price on-chain in 1 transaction."
                  : "Waiting for seller to commit this agreed price on-chain."}
              </div>
            </div>
          </div>

          {/* Seller Action: Commit to on-chain */}
          {isProvider && parseFloat(onChainBudget) !== agreedBid.bid_amount && onCommitBudget && (
            <button
              onClick={() => onCommitBudget(agreedBid.bid_amount!.toString())}
              disabled={isCommittingBudget}
              className="btn-primary"
              style={{
                padding: "8px 16px",
                fontSize: "0.82rem",
                background: "linear-gradient(135deg, #10b981, #059669)",
                borderColor: "#10b981"
              }}
            >
              {isCommittingBudget ? "Submitting..." : `Submit ${agreedBid.bid_amount} USDC On-Chain`}
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}

      {/* Pop-down Quick Bid Proposal Drawer */}
      {showBidModal && jobStatus === 0 && (
        <form onSubmit={handleSubmitBid} style={{
          background: "rgba(15, 15, 26, 0.95)",
          borderBottom: "1px solid rgba(99,102,241,0.25)",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "10px"
        }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#e2e8f0" }}>
            Submit an Off-Chain Price Proposal (USDC)
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {[25, 50, 100, 250, 500].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setBidAmountInput(preset.toString())}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  fontSize: "0.75rem",
                  color: "#cbd5e1",
                  cursor: "pointer"
                }}
              >
                ${preset}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                $
              </span>
              <input
                type="number"
                step="any"
                min="0.01"
                placeholder="Enter offer amount in USDC"
                value={bidAmountInput}
                onChange={(e) => setBidAmountInput(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px 9px 28px",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(99,102,241,0.3)",
                  color: "#fff",
                  fontSize: "0.88rem"
                }}
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={!bidAmountInput || isSending}
              className="btn-primary"
              style={{ padding: "9px 18px", fontSize: "0.85rem", whiteSpace: "nowrap" }}
            >
              Propose Bid
            </button>
          </div>
        </form>
      )}

      {/* Messages Feed */}
      <div
        ref={chatFeedRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}
      >
        {messages.length === 0 && (
          <div style={{
            margin: "auto",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: "0.85rem",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px"
          }}>
            <Sparkles size={24} style={{ color: "#818cf8", opacity: 0.8 }} />
            <div>No messages or bids yet.</div>
            <div style={{ fontSize: "0.76rem" }}>
              Start by saying hello or submitting a starting bid!
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isMe = activeAddr && msg.sender.toLowerCase() === activeAddr;
          const isBid = msg.type === "bid";
          const isAcceptedBid = msg.status === "accepted";
          const isDeclinedBid = msg.status === "declined";
          const isSupersededBid = msg.status === "superseded";
          const isAcceptEvent = msg.type === "accept_bid";
          const isDeclineEvent = msg.type === "decline_bid";

          // System / Notification messages
          if (isAcceptEvent || isDeclineEvent) {
            return (
              <div
                key={msg.id}
                style={{
                  margin: "6px auto",
                  padding: "6px 14px",
                  borderRadius: "20px",
                  background: isAcceptEvent ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
                  border: isAcceptEvent ? "1px solid rgba(16,185,129,0.2)" : "1px solid rgba(239,68,68,0.2)",
                  fontSize: "0.78rem",
                  color: isAcceptEvent ? "#10b981" : "#ef4444",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  maxWidth: "90%",
                  textAlign: "center"
                }}
              >
                {isAcceptEvent ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                <span>{msg.text}</span>
              </div>
            );
          }

          // Special Visual Card for Bids
          if (isBid) {
            const isOfferFromOtherParty = !isMe && msg.status === "pending";

            return (
              <div
                key={msg.id}
                style={{
                  margin: isMe ? "4px 0 4px auto" : "4px auto 4px 0",
                  maxWidth: "85%",
                  width: "360px",
                  background: isAcceptedBid
                    ? "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(16,185,129,0.04))"
                    : isDeclinedBid || isSupersededBid
                    ? "rgba(255,255,255,0.02)"
                    : "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.06))",
                  border: isAcceptedBid
                    ? "1px solid rgba(16,185,129,0.4)"
                    : isDeclinedBid || isSupersededBid
                    ? "1px solid rgba(255,255,255,0.06)"
                    : "1px solid rgba(99,102,241,0.35)",
                  borderRadius: "14px",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.2)"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Tag size={14} style={{ color: isAcceptedBid ? "#10b981" : "#818cf8" }} />
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                      {isMe ? "Your Price Offer" : "Incoming Price Offer"}
                    </span>
                  </div>
                  {getSenderBadge(msg)}
                </div>

                <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                  <span style={{ fontSize: "1.4rem", fontWeight: 900, color: isAcceptedBid ? "#10b981" : "#fff" }}>
                    ${msg.bid_amount?.toFixed(2)}
                  </span>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    USDC
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                {/* Status Badges */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {msg.status === "pending" && (
                    <span style={{ fontSize: "0.7rem", color: "#818cf8", background: "rgba(99,102,241,0.1)", padding: "2px 8px", borderRadius: "4px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <Clock size={11} /> Awaiting Response
                    </span>
                  )}
                  {msg.status === "accepted" && (
                    <span style={{ fontSize: "0.7rem", color: "#10b981", background: "rgba(16,185,129,0.15)", padding: "2px 8px", borderRadius: "4px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <CheckCircle2 size={11} /> Accepted Price
                    </span>
                  )}
                  {msg.status === "declined" && (
                    <span style={{ fontSize: "0.7rem", color: "#ef4444", background: "rgba(239,68,68,0.1)", padding: "2px 8px", borderRadius: "4px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <XCircle size={11} /> Declined
                    </span>
                  )}
                  {msg.status === "superseded" && (
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.04)", padding: "2px 8px", borderRadius: "4px" }}>
                      Superseded by newer bid
                    </span>
                  )}
                </div>

                {/* Counterparty Action Buttons */}
                {isOfferFromOtherParty && jobStatus === 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "4px" }}>
                    <button
                      onClick={() => handleAcceptBid(msg)}
                      disabled={isSending}
                      className="btn-primary"
                      style={{
                        padding: "6px 12px",
                        fontSize: "0.78rem",
                        justifyContent: "center",
                        background: "linear-gradient(135deg, #10b981, #059669)",
                        borderColor: "#10b981"
                      }}
                    >
                      Accept ${msg.bid_amount}
                    </button>
                    <button
                      onClick={() => handleDeclineBid(msg)}
                      disabled={isSending}
                      className="btn-secondary"
                      style={{
                        padding: "6px 12px",
                        fontSize: "0.78rem",
                        justifyContent: "center",
                        borderColor: "rgba(239,68,68,0.4)",
                        color: "#f87171"
                      }}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            );
          }

          // Regular Text Message Bubble
          return (
            <div
              key={msg.id}
              style={{
                alignSelf: isMe ? "flex-end" : "flex-start",
                maxWidth: "75%",
                display: "flex",
                flexDirection: "column",
                gap: "3px",
                alignItems: isMe ? "flex-end" : "flex-start"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                {!isMe && getSenderBadge(msg)}
                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                {isMe && getSenderBadge(msg)}
              </div>

              <div
                style={{
                  background: isMe ? "linear-gradient(135deg, #6366f1, #4f46e5)" : "rgba(255,255,255,0.06)",
                  border: isMe ? "none" : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: isMe ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                  padding: "10px 14px",
                  color: isMe ? "#fff" : "var(--text-primary)",
                  fontSize: "0.85rem",
                  lineHeight: 1.45,
                  wordBreak: "break-word"
                }}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input Form Bar */}
      <form
        onSubmit={handleSendMessage}
        style={{
          padding: "12px 16px",
          background: "rgba(255,255,255,0.02)",
          borderTop: "1px solid var(--border-color)",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}
      >
        <input
          type="text"
          placeholder="Type message or negotiation term..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isSending}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: "10px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border-color)",
            color: "var(--text-primary)",
            fontSize: "0.85rem",
            outline: "none"
          }}
        />

        <button
          type="submit"
          disabled={!inputText.trim() || isSending}
          className="btn-primary"
          style={{
            padding: "10px 14px",
            borderRadius: "10px",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "40px"
          }}
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
