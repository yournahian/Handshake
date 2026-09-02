"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useWallet } from "@/hooks/useWallet";

/* ─── Types ─────────────────────────────────────────────────────────────────── */

export type NotificationType =
  | "FUNDED"
  | "COUNTER_OFFER"
  | "SUBMITTED"
  | "SETTLED"
  | "DISPUTE"
  | "REVIEW_RECEIVED"
  | "REFERRAL_REWARD";

export interface Notification {
  id: string;
  recipient_address: string;
  type: NotificationType;
  escrow_id?: number;
  message: string;
  read: boolean;
  metadata?: Record<string, any>;
  created_at: string;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  addNotification: (n: Omit<Notification, "id" | "created_at" | "read">) => Promise<void>;
  refresh: () => Promise<void>;
}

/* ─── Context ───────────────────────────────────────────────────────────────── */

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  addNotification: async () => {},
  refresh: async () => {},
});

export const useNotifications = () => useContext(NotificationContext);

/* ─── Provider ──────────────────────────────────────────────────────────────── */

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { address } = useWallet();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const channelRef = useRef<any>(null);

  const hasSupabase =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const fetchNotifications = useCallback(async () => {
    if (!address || !hasSupabase) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient_address", address.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setNotifications(data as Notification[]);
  }, [address, hasSupabase]);

  // Subscribe to realtime new notifications
  useEffect(() => {
    if (!address || !hasSupabase) return;
    fetchNotifications();

    // Cleanup previous channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    channelRef.current = supabase
      .channel(`notifications:${address.toLowerCase()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_address=eq.${address.toLowerCase()}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev]);
          // Browser notification (if permission granted)
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            new Notification("Handshake", {
              body: (payload.new as Notification).message,
              icon: "/favicon.ico",
            });
          }
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [address, hasSupabase, fetchNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    if (!hasSupabase) return;
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, [hasSupabase]);

  const markAllAsRead = useCallback(async () => {
    if (!address || !hasSupabase) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("recipient_address", address.toLowerCase())
      .eq("read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [address, hasSupabase]);

  const addNotification = useCallback(async (
    n: Omit<Notification, "id" | "created_at" | "read">
  ) => {
    if (!hasSupabase) return;
    await supabase.from("notifications").insert({
      ...n,
      recipient_address: n.recipient_address.toLowerCase(),
      read: false,
    });
  }, [hasSupabase]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
        markAsRead,
        markAllAsRead,
        addNotification,
        refresh: fetchNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
