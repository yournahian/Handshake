"use client";

/**
 * WalletMethodSelector
 * ─────────────────────────────────────────────────────────────────────────────
 * Modal that lets the user choose between:
 *   1. Circle Smart Wallet (PIN-secured MPC — no MetaMask needed)
 *   2. MetaMask + CCTP Bridge (cross-chain USDC bridging via standard EVM wallet)
 */

import React from "react";
import { Wallet, GitMerge, ArrowRight, ShieldCheck, Zap } from "lucide-react";

export type WalletMethod = "circle" | "cctp";

interface Props {
  onSelect: (method: WalletMethod) => void;
}

export function WalletMethodSelector({ onSelect }: Props) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.78)",
      backdropFilter: "blur(10px)",
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
        padding: "24px 22px",
        maxWidth: "440px",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
      }}>

        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: "44px", height: "44px", borderRadius: "14px",
            background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))",
            border: "1px solid rgba(99,102,241,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 10px",
          }}>
            <Wallet size={22} style={{ color: "#818cf8" }} />
          </div>
          <h2 style={{ margin: "0 0 4px", fontSize: "1.15rem", fontWeight: 800 }}>
            Choose Your Wallet
          </h2>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted, #888)", lineHeight: 1.5 }}>
            How would you like to manage USDC on Handshake?
          </p>
        </div>

        {/* Option 1 — Circle Smart Wallet */}
        <button
          onClick={() => onSelect("circle")}
          style={{
            display: "flex", flexDirection: "column", gap: "8px",
            padding: "16px", borderRadius: "14px", border: "1px solid rgba(99,102,241,0.3)",
            background: "rgba(99,102,241,0.06)", cursor: "pointer", textAlign: "left",
            transition: "all 0.2s", width: "100%",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.12)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.5)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.06)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.3)"; }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "10px",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <ShieldCheck size={18} style={{ color: "#fff" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Circle Smart Wallet</div>
                <div style={{ fontSize: "0.74rem", color: "var(--text-muted, #888)" }}>No MetaMask needed</div>
              </div>
            </div>
            <ArrowRight size={16} style={{ color: "#818cf8", flexShrink: 0 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {[
              "🔒 Secured by 6-digit PIN",
              "🛡️ MPC — keys never fully exposed",
              "📱 Works inside Telegram",
            ].map(txt => (
              <div key={txt} style={{ fontSize: "0.76rem", color: "var(--text-secondary, #aaa)" }}>{txt}</div>
            ))}
          </div>
        </button>

        {/* Option 2 — MetaMask + CCTP */}
        <button
          onClick={() => onSelect("cctp")}
          style={{
            display: "flex", flexDirection: "column", gap: "8px",
            padding: "16px", borderRadius: "14px", border: "1px solid rgba(251,191,36,0.25)",
            background: "rgba(251,191,36,0.04)", cursor: "pointer", textAlign: "left",
            transition: "all 0.2s", width: "100%",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(251,191,36,0.09)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(251,191,36,0.45)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(251,191,36,0.04)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(251,191,36,0.25)"; }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "10px",
                background: "linear-gradient(135deg, #f59e0b, #ef4444)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <GitMerge size={18} style={{ color: "#fff" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>MetaMask + CCTP Bridge</div>
                <div style={{ fontSize: "0.74rem", color: "var(--text-muted, #888)" }}>Cross-chain USDC transfers</div>
              </div>
            </div>
            <ArrowRight size={16} style={{ color: "#f59e0b", flexShrink: 0 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {[
              "⟠ Bridge USDC across Eth, Base, Avax, Arbitrum",
              "🦊 Uses your existing MetaMask wallet",
              "⚡ Native burn-and-mint via Circle CCTP V2",
            ].map(txt => (
              <div key={txt} style={{ fontSize: "0.76rem", color: "var(--text-secondary, #aaa)" }}>{txt}</div>
            ))}
          </div>
        </button>

        <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--text-muted, #666)", textAlign: "center", lineHeight: 1.4 }}>
          You can switch between methods anytime.
        </p>
      </div>
    </div>
  );
}

