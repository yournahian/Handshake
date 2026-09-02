import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// GET /api/webhooks?address=0x...
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  const { data } = await supabaseAdmin
    .from("user_webhooks")
    .select("id, webhook_url, events, active, created_at")
    .eq("owner_address", address)
    .maybeSingle();

  return NextResponse.json({ webhook: data });
}

// POST /api/webhooks — create/update a webhook
export async function POST(req: NextRequest) {
  try {
    const { address, webhookUrl, events } = await req.json();
    if (!address || !webhookUrl) return NextResponse.json({ error: "address and webhookUrl required" }, { status: 400 });

    // Validate URL
    try { new URL(webhookUrl); } catch {
      return NextResponse.json({ error: "Invalid webhook URL" }, { status: 400 });
    }

    const secret = crypto.randomBytes(24).toString("hex");

    await supabaseAdmin.from("user_webhooks").upsert({
      owner_address: address.toLowerCase(),
      webhook_url: webhookUrl,
      secret,
      events: events || ["FUNDED", "SETTLED", "DISPUTE"],
      active: true,
    }, { onConflict: "owner_address" });

    return NextResponse.json({ ok: true, secret, message: "Webhook saved. Store your secret — it won't be shown again." });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/webhooks?address=0x...
export async function DELETE(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  await supabaseAdmin.from("user_webhooks").delete().eq("owner_address", address);
  return NextResponse.json({ ok: true });
}

/* ─── Helper: fire a webhook ────────────────────────────────────────────────── */
async function fireWebhook(
  recipientAddress: string,
  eventType: string,
  payload: Record<string, any>
) {
  try {
    const { data: wh } = await supabaseAdmin
      .from("user_webhooks")
      .select("webhook_url, secret, events, active")
      .eq("owner_address", recipientAddress.toLowerCase())
      .eq("active", true)
      .maybeSingle();

    if (!wh || !wh.events.includes(eventType)) return;

    const body = JSON.stringify({ event: eventType, ...payload, timestamp: Date.now() });
    const sig = crypto.createHmac("sha256", wh.secret).update(body).digest("hex");

    await fetch(wh.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Handshake-Signature": `sha256=${sig}`,
        "X-Handshake-Event": eventType,
      },
      body,
    });
  } catch (err) {
    console.error("[Webhook Fire]", err);
  }
}
