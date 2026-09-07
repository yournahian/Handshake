"use client";

import React, { useState, useRef, useEffect } from "react";
import { Bell, Check, CheckCheck, X, ShieldAlert, DollarSign, FileCheck, Star, Gift, Zap } from "lucide-react";
import { useNotifications, Notification, NotificationType } from "./NotificationContext";
import { useRouter } from "next/navigation";

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function iconForType(type: NotificationType) {
  const size = 14;
  const icons: Record<NotificationType, React.ReactNode> = {
    FUNDED:          <DollarSign size={size} />,
    COUNTER_OFFER:   <Zap size={size} />,
    SUBMITTED:       <FileCheck size={size} />,
    SETTLED:         <CheckCheck size={size} />,
    DISPUTE:         <ShieldAlert size={size} />,
    REVIEW_RECEIVED: <Star size={size} />,
    REFERRAL_REWARD: <Gift size={size} />,
  };
  return icons[type] ?? <Bell size={size} />;
}

function colorForType(type: NotificationType): string {
  const colors: Record<NotificationType, string> = {
    FUNDED:          "#10b981",
    COUNTER_OFFER:   "#f59e0b",
    SUBMITTED:       "#818cf8",
    SETTLED:         "#10b981",
    DISPUTE:         "#ef4444",
    REVIEW_RECEIVED: "#f59e0b",
    REFERRAL_REWARD: "#8b5cf6",
  };
  return colors[type] ?? "#6b7280";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ─── NotificationBell ──────────────────────────────────────────────────────── */

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleClick = async (n: Notification) => {
    await markAsRead(n.id);
    setOpen(false);

    let meta = n.metadata;
    if (typeof meta === "string") {
      try {
        meta = JSON.parse(meta);
      } catch (e) {}
    }

    if (meta?.proposal_id) {
      router.push(`/escrow/create?proposalId=${meta.proposal_id}`);
    } else if (n.escrow_id) {
      router.push(`/escrow/${n.escrow_id}`);
    }
  };

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        title="Notifications"
        style={{
          position: "relative",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "10px",
          width: "36px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: open ? "hsl(var(--primary))" : "rgba(255,255,255,0.7)",
          transition: "all 0.2s",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
        onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span style={{
            position: "absolute",
            top: "-4px",
            right: "-4px",
            background: "#ef4444",
            color: "#fff",
            fontSize: "0.6rem",
            fontWeight: 800,
            borderRadius: "999px",
            minWidth: "16px",
            height: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 3px",
            boxShadow: "0 0 0 2px hsl(var(--background))",
            animation: "pulse 2s infinite",
          }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div className="notification-dropdown-panel">
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 16px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Bell size={14} style={{ color: "hsl(var(--primary))" }} />
              <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#f1f5f9" }}>
                Notifications
              </span>
              {unreadCount > 0 && (
                <span style={{
                  background: "rgba(99,102,241,0.2)",
                  color: "#818cf8",
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  borderRadius: "999px",
                  padding: "2px 7px",
                }}>
                  {unreadCount} new
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  title="Mark all read"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#6b7280", fontSize: "0.72rem", display: "flex",
                    alignItems: "center", gap: "4px",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#f1f5f9")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}
                >
                  <Check size={12} /> All read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", display: "flex" }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div style={{ maxHeight: "380px", overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: "32px 16px", gap: "8px", color: "#6b7280",
              }}>
                <Bell size={28} style={{ opacity: 0.3 }} />
                <span style={{ fontSize: "0.82rem" }}>No notifications yet</span>
              </div>
            ) : (
              notifications.slice(0, 30).map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    padding: "12px 16px",
                    cursor: "pointer",
                    background: n.read ? "transparent" : "rgba(99,102,241,0.05)",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                  onMouseLeave={e => (e.currentTarget.style.background = n.read ? "transparent" : "rgba(99,102,241,0.05)")}
                >
                  {/* Icon bubble */}
                  <div style={{
                    width: "30px",
                    height: "30px",
                    borderRadius: "50%",
                    background: `${colorForType(n.type)}22`,
                    border: `1px solid ${colorForType(n.type)}44`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: colorForType(n.type),
                    flexShrink: 0,
                  }}>
                    {iconForType(n.type)}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0,
                      fontSize: "0.8rem",
                      color: n.read ? "#9ca3af" : "#e2e8f0",
                      fontWeight: n.read ? 400 : 600,
                      lineHeight: 1.4,
                      wordBreak: "break-word",
                      whiteSpace: "normal",
                    }}>
                      {n.message}
                    </p>
                    <span style={{ fontSize: "0.68rem", color: "#6b7280" }}>
                      {timeAgo(n.created_at)}
                      {n.escrow_id ? ` · Escrow #${n.escrow_id}` : ""}
                    </span>
                  </div>

                  {!n.read && (
                    <div style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      background: "hsl(var(--primary))",
                      flexShrink: 0,
                      marginTop: "4px",
                    }} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
