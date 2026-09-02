"use client";

/**
 * CircleWalletSetup
 * ─────────────────────────────────────────────────────────────────────────────
 * Floating modal that appears when a user's Circle wallet needs to be set up.
 * Guides them through the PIN + security-question challenge flow.
 */

import React, { useState, useEffect } from "react";
import { useCircleWallet } from "./CircleWalletContext";
import type { WalletStatus } from "./CircleWalletContext";
import { ShieldCheck, Loader2, AlertCircle, X, Wallet, ArrowRight } from "lucide-react";

export function CircleWalletSetup() {
  const { status, wallet, errorMessage, setupWallet } = useCircleWallet();
  const [dismissed, setDismissed] = useState(false);
  const [setting, setSetting] = useState(false);
  const [isTelegram, setIsTelegram] = useState(false);

  useEffect(() => {
    setIsTelegram(!!(window as any).Telegram?.WebApp?.initData);
  }, []);

  // On web, the header handles Circle wallet — only auto-show in Telegram Mini App
  if (!isTelegram) return null;

  // Only show when Circle wallet setup is required and not dismissed
  if (dismissed || status === "idle" || status === "ready") return null;

  // Don't show if the wallet is already live
  if (wallet?.state === "LIVE") return null;

  // Re-assert the full WalletStatus union after the early-return guards above
  // (TypeScript narrows 'ready' out — this cast restores it for the JSX below)
  const currentStatus = status as WalletStatus;

  const handleSetup = async () => {
    setSetting(true);
    try {
      await setupWallet();
    } finally {
      setSetting(false);
    }
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0, 0, 0, 0.75)",
      backdropFilter: "blur(8px)",
      zIndex: 10000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
    }}>
      <div style={{
        background: "var(--bg-card, #0f0f1a)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "20px",
        padding: "36px",
        maxWidth: "420px",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        position: "relative",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        {/* Dismiss */}
        <button
          onClick={() => setDismissed(true)}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
          }}
        >
          <X size={18} />
        </button>

        {/* Icon */}
        <div style={{
          width: "56px",
          height: "56px",
          borderRadius: "16px",
          background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))",
          border: "1px solid rgba(99,102,241,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Wallet size={26} style={{ color: "#818cf8" }} />
        </div>

        {/* Content */}
        {status === "loading" && (
          <>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700 }}>
              Setting up your wallet…
            </h2>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-muted, #888)", lineHeight: 1.6 }}>
              Please wait while we initialize your secure Circle wallet.
            </p>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
              <Loader2 size={32} style={{ color: "#818cf8", animation: "spin 1s linear infinite" }} />
            </div>
          </>
        )}

        {status === "setup_required" && !setting && (
          <>
            <div>
              <h2 style={{ margin: "0 0 8px", fontSize: "1.3rem", fontWeight: 700 }}>
                Create your secure wallet
              </h2>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-muted, #888)", lineHeight: 1.6 }}>
                Handshake creates a secure, non-custodial wallet for you automatically — 
                no seed phrases needed. You'll set a <strong>6-digit PIN</strong> and 
                2 security questions that only you know.
              </p>
            </div>

            <div style={{
              background: "rgba(99,102,241,0.06)",
              border: "1px solid rgba(99,102,241,0.15)",
              borderRadius: "12px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}>
              {[
                { icon: "🔒", label: "PIN-secured", desc: "Protected by a 6-digit PIN only you know" },
                { icon: "🛡", label: "MPC Technology", desc: "Your key is split — not stored anywhere" },
                { icon: "📤", label: "Withdraw anytime", desc: "Send funds to MetaMask or any wallet" },
              ].map(({ icon, label, desc }) => (
                <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                  <span style={{ fontSize: "1.2rem", lineHeight: 1.3 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted, #888)" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleSetup}
              disabled={setting}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "14px 24px",
                borderRadius: "12px",
                border: "none",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff",
                fontWeight: 700,
                fontSize: "0.95rem",
                cursor: "pointer",
                transition: "opacity 0.2s",
              }}
            >
              Create My Wallet <ArrowRight size={18} />
            </button>
          </>
        )}

        {(status === "loading" && setting) && (
          <>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700 }}>
              Follow the prompts…
            </h2>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-muted, #888)", lineHeight: 1.6 }}>
              Complete the <strong>PIN setup</strong> and answer the security questions 
              in the Circle secure dialog that just opened.
            </p>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
              <Loader2 size={32} style={{ color: "#818cf8", animation: "spin 1s linear infinite" }} />
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "#ef4444" }}>
              Something went wrong
            </h2>
            <div style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "14px",
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "10px",
            }}>
              <AlertCircle size={18} style={{ color: "#ef4444", flexShrink: 0, marginTop: "2px" }} />
              <p style={{ margin: 0, fontSize: "0.85rem", color: "#ef4444", lineHeight: 1.5 }}>
                {errorMessage || "Wallet initialization failed. Please try again."}
              </p>
            </div>
            <button
              onClick={handleSetup}
              style={{
                padding: "12px 24px",
                borderRadius: "12px",
                border: "1px solid rgba(99,102,241,0.3)",
                background: "rgba(99,102,241,0.1)",
                color: "#818cf8",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Retry Setup
            </button>
          </>
        )}

        {currentStatus === "ready" && (
          <>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "#10b981" }}>
              Wallet Ready! 🎉
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <ShieldCheck size={20} style={{ color: "#10b981" }} />
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#10b981" }}>
                Your secure Circle wallet is active.
              </p>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
