"use client";

import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { LogOut, Wallet, ShieldCheck, X, ChevronRight } from "lucide-react";
import { useCircleWallet } from "./CircleWalletContext";
import { CircleWalletProfile } from "./CircleWalletProfile";

export function HeaderWallet() {
  const [mounted, setMounted] = useState(false);

  // Circle Wallet state
  const { status: circleStatus, email: circleEmail, wallet: circleWallet, logout: circleLogout, loginWithEmail, setupWallet } = useCircleWallet();
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Automatically trigger PIN setup modal when user login succeeds but no wallet exists yet
  useEffect(() => {
    if (circleStatus === "setup_required") {
      setupWallet();
    }
  }, [circleStatus, setupWallet]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !emailInput.includes("@")) return;
    setIsSubmittingEmail(true);
    try {
      await loginWithEmail(emailInput);
      setShowEmailModal(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingEmail(false);
    }
  };

  if (!mounted) {
    return (
      <div style={{ position: "relative" }}>
        <button
          className="btn-primary"
          style={{ padding: "8px 16px", fontSize: "0.85rem" }}
          disabled
        >
          <span className="hidden sm:inline">Connect</span>
          <Wallet size={16} className="sm:hidden" />
        </button>
      </div>
    );
  }

  // ── Circle Wallet active (logged in) ──────────────────────────────────────
  const circleReady = circleStatus === "ready" && circleWallet;
  if (circleReady) {
    const shortAddr = `${circleWallet.address.slice(0, 6)}…${circleWallet.address.slice(-4)}`;
    return (
      <>
        <button
          onClick={() => setShowProfile(p => !p)}
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.28)",
            borderRadius: "10px", padding: "6px 12px",
            cursor: "pointer", transition: "background 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.16)")}
          onMouseLeave={e => (e.currentTarget.style.background = "rgba(99,102,241,0.08)")}
        >
          <div style={{
            width: "26px", height: "26px", borderRadius: "8px",
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <ShieldCheck size={13} style={{ color: "#fff" }} />
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: "0.72rem", color: "#a5b4fc", fontWeight: 700, lineHeight: 1.2 }}>
              {shortAddr}
            </div>
            {circleEmail && (
              <div className="hidden sm:block" style={{ fontSize: "0.63rem", color: "#6b7280", lineHeight: 1.2 }}>
                {circleEmail.length > 20 ? circleEmail.slice(0, 18) + "…" : circleEmail}
              </div>
            )}
          </div>
          <ChevronRight size={13} style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }} />
        </button>

        {showProfile && mounted && (
          <CircleWalletProfile onClose={() => setShowProfile(false)} />
        )}
      </>
    );
  }

  // ── Not connected — show connect button which opens email modal directly ────
  return (
    <>
      <div style={{ position: "relative" }}>
        <button
          onClick={() => {
            if (circleStatus === "setup_required" || circleStatus === "error") {
              setupWallet();
            } else {
              setShowEmailModal(true);
            }
          }}
          className="btn-primary"
          style={{ padding: "8px 16px", fontSize: "0.85rem", minHeight: "36px", display: "flex", alignItems: "center", gap: "6px" }}
        >
          <span className="hidden sm:inline">Sign In / Sign Up</span>
          <Wallet size={16} />
        </button>
      </div>

      {/* ── Circle Email Login Modal — portalled to body ───────────────────── */}
      {showEmailModal && mounted && ReactDOM.createPortal(
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)",
          backdropFilter: "blur(10px)", zIndex: 10000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
        }}>
          <div style={{
            background: "var(--bg-card, #0f0f1a)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "20px", padding: "32px 28px",
            maxWidth: "380px", width: "100%",
            display: "flex", flexDirection: "column", gap: "18px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)", position: "relative",
          }}>
            <button
              onClick={() => setShowEmailModal(false)}
              style={{
                position: "absolute", top: "14px", right: "14px",
                background: "none", border: "none",
                color: "rgba(255,255,255,0.4)", cursor: "pointer", display: "flex",
              }}
            >
              <X size={18} />
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{
                width: "40px", height: "40px", borderRadius: "12px",
                background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))",
                border: "1px solid rgba(99,102,241,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <ShieldCheck size={20} style={{ color: "#818cf8" }} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>Circle Smart Wallet</h3>
                <p style={{ margin: 0, fontSize: "0.75rem", color: "#888" }}>Sign in with your email</p>
              </div>
            </div>

            <form onSubmit={handleEmailSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <input
                type="email"
                placeholder="Enter your email address"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                autoFocus
                style={{
                  padding: "11px 14px", borderRadius: "10px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#e2e8f0", fontSize: "0.88rem", outline: "none",
                  width: "100%", boxSizing: "border-box",
                }}
              />
              <button
                type="submit"
                disabled={isSubmittingEmail}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                  padding: "12px 20px", borderRadius: "10px", border: "none",
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  color: "#fff", fontWeight: 700, fontSize: "0.88rem",
                  cursor: isSubmittingEmail ? "default" : "pointer",
                  opacity: isSubmittingEmail ? 0.7 : 1, transition: "opacity 0.2s",
                }}
              >
                {isSubmittingEmail ? "Setting up…" : "Sign In / Sign Up"}
              </button>
            </form>

            <p style={{ margin: 0, fontSize: "0.72rem", color: "#666", textAlign: "center", lineHeight: 1.5 }}>
              A PIN-secured MPC wallet will be created for your account. No seed phrases needed.
            </p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
