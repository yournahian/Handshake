import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Fallback in-memory cache for environments where Supabase table is not yet migrated
const memoryStore: Record<string, any[]> = {};

export async function GET(
  req: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const params = await Promise.resolve(context?.params);
    const rawId = params?.id;
    const jobId = Number(rawId);
    if (!rawId || isNaN(jobId)) {
      return NextResponse.json({ messages: [] });
    }

    const hasSupabase =
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder");

    if (hasSupabase) {
      try {
        const { data, error } = await supabase
          .from("escrow_messages")
          .select("*")
          .eq("job_id", jobId)
          .order("created_at", { ascending: true });

        if (!error && Array.isArray(data)) {
          return NextResponse.json({ messages: data });
        }
      } catch (dbErr) {
        // Fall back to memory
      }
    }

    const cached = memoryStore[jobId] || [];
    return NextResponse.json({ messages: cached });
  } catch (err: any) {
    const rawId = context?.params?.id;
    const cached = rawId ? memoryStore[Number(rawId)] || [] : [];
    return NextResponse.json({ messages: cached });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const params = await Promise.resolve(context?.params);
    const rawId = params?.id;
    const jobId = Number(rawId);
    if (!rawId || isNaN(jobId)) {
      return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
    }

    const body = await req.json();
    const {
      sender,
      senderRole,
      type = "text",
      text = "",
      bidAmount = null,
      status = "pending",
      actionBidId = null,
    } = body;

    if (!sender) {
      return NextResponse.json({ error: "Sender address is required" }, { status: 400 });
    }

    const newMessage = {
      id: body.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      job_id: jobId,
      sender: sender.toLowerCase(),
      sender_role: senderRole || "user",
      type, // 'text' | 'bid' | 'accept_bid' | 'decline_bid' | 'agreement'
      text,
      bid_amount: bidAmount !== null && bidAmount !== undefined ? Number(bidAmount) : null,
      status, // 'pending' | 'accepted' | 'declined' | 'superseded'
      created_at: new Date().toISOString(),
    };

    const hasSupabase =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (hasSupabase) {
      try {
        // If this is an accept_bid or decline_bid action, optionally update prior bid status
        if (actionBidId) {
          await supabase
            .from("escrow_messages")
            .update({ status: type === "accept_bid" ? "accepted" : "declined" })
            .eq("id", actionBidId);
        } else if (type === "bid") {
          // Mark older pending bids for this job as superseded
          await supabase
            .from("escrow_messages")
            .update({ status: "superseded" })
            .eq("job_id", jobId)
            .eq("type", "bid")
            .eq("status", "pending");
        }

        const { data, error } = await supabase
          .from("escrow_messages")
          .insert(newMessage)
          .select()
          .single();

        if (!error && data) {
          // Also update in-memory store
          if (!memoryStore[jobId]) memoryStore[jobId] = [];
          memoryStore[jobId].push(data);
          return NextResponse.json({ message: data });
        }
      } catch (dbErr) {
        console.warn("[API Messages POST] Supabase insert fallback to memory:", dbErr);
      }
    }

    // Memory Store fallback
    if (!memoryStore[jobId]) memoryStore[jobId] = [];

    if (actionBidId) {
      const prior = memoryStore[jobId].find((m) => m.id === actionBidId);
      if (prior) {
        prior.status = type === "accept_bid" ? "accepted" : "declined";
      }
    } else if (type === "bid") {
      memoryStore[jobId].forEach((m) => {
        if (m.type === "bid" && m.status === "pending") {
          m.status = "superseded";
        }
      });
    }

    memoryStore[jobId].push(newMessage);

    return NextResponse.json({ message: newMessage });
  } catch (err: any) {
    console.error("[API Messages POST Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
