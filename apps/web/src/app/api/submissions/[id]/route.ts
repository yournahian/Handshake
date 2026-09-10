import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  
  // 1. Try fetching from Supabase directly
  const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (hasSupabase) {
    try {
      const { data, error } = await supabase
        .from("escrow_submissions")
        .select("*")
        .eq("job_id", Number(id))
        .maybeSingle();

      if (data && !error) {
        return NextResponse.json({
          fileUrl: data.file_url,
          fileName: data.file_name,
          status: data.status,
          result: data.result,
          source: data.source,
          buyerAuthorized: data.buyer_authorized
        });
      }
    } catch (err: any) {
      console.warn("API Route direct Supabase fetch failed:", err.message || err);
    }
  }

  // 2. Fall back to bot backend if available
  try {
    const botUrl = process.env.BOT_SERVER_URL || process.env.NEXT_PUBLIC_BOT_SERVER_URL || "http://localhost:4000";
    const res = await fetch(`${botUrl.replace(/\/$/, "")}/api/submissions/${id}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "No submission found" }, { status: 404 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: "No active submission found" }, { status: 404 });
  }
}
