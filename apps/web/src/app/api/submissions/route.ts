import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, fileUrl, fileName } = body;

    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (hasSupabase) {
      try {
        await supabase.from("escrow_submissions").upsert({
          job_id: Number(jobId),
          file_url: fileUrl,
          file_name: fileName || "deliverable",
          status: "Pending Verification",
          result: "AI verification agent analyzing the uploaded deliverable...",
          source: "web"
        });
      } catch (err: any) {
        console.warn("POST Route direct Supabase insert failed:", err.message || err);
      }
    }

    const botUrl = process.env.BOT_SERVER_URL || process.env.NEXT_PUBLIC_BOT_SERVER_URL || "http://localhost:4000";
    try {
      const res = await fetch(`${botUrl.replace(/\/$/, "")}/api/submissions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch (botErr: any) {
      console.warn(`Direct bot call to ${botUrl} failed:`, botErr.message || botErr);
      if (hasSupabase) {
        return NextResponse.json({
          success: true,
          message: "Submission received in cloud database. AI verification agent will evaluate shortly."
        }, { status: 202 });
      }
      throw botErr;
    }
  } catch (error: any) {
    console.error("Failed to post submission:", error.message || error);
    return NextResponse.json({ error: "Verification backend is offline. Please launch the bot or check database connection." }, { status: 503 });
  }
}
