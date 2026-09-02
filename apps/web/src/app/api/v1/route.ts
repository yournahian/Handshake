import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// Middleware: validate API key
async function validateApiKey(req: NextRequest): Promise<{ valid: boolean; address?: string }> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { valid: false };
  const rawKey = auth.slice(7);
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const { data } = await supabaseAdmin
    .from("api_keys")
    .select("owner_address, revoked")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!data || data.revoked) return { valid: false };
  // Update last used
  await supabaseAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("key_hash", hash);
  return { valid: true, address: data.owner_address };
}

// GET /api/v1/escrows — list recent escrows (public)
// GET /api/v1/escrows?address=0x... — filter by party
export async function GET(req: NextRequest) {
  try {
    const address = req.nextUrl.searchParams.get("address");
    const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "20"), 50);
    const offset = (page - 1) * limit;

    // For now we expose the user_profiles and reviews as public stats
    // Escrow on-chain data is read from the blockchain, not DB
    // This endpoint returns platform stats + user reputation data

    if (req.nextUrl.pathname.includes("/users/")) {
      const addr = req.nextUrl.pathname.split("/users/")[1]?.split("/")[0];
      if (!addr) return NextResponse.json({ error: "address required" }, { status: 400 });

      const [profileRes, reviewsRes] = await Promise.all([
        supabaseAdmin.from("user_profiles").select("username, completed_escrows, disputed_escrows").eq("address", addr.toLowerCase()).maybeSingle(),
        supabaseAdmin.from("reviews").select("rating, comment, reviewer_address, created_at").eq("reviewee_address", addr.toLowerCase()).order("created_at", { ascending: false }).limit(10),
      ]);

      const reviews = reviewsRes.data || [];
      const avgRating = reviews.length > 0 ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length : 0;

      return NextResponse.json({
        address: addr,
        username: profileRes.data?.username,
        completedEscrows: profileRes.data?.completed_escrows ?? 0,
        disputedEscrows:  profileRes.data?.disputed_escrows  ?? 0,
        avgRating: Math.round(avgRating * 10) / 10,
        reviews,
      });
    }

    // Platform stats
    const { count: totalUsers }  = await supabaseAdmin.from("user_profiles").select("*", { count: "exact", head: true });
    const { count: totalReviews } = await supabaseAdmin.from("reviews").select("*", { count: "exact", head: true });

    return NextResponse.json({
      platform: "Handshake",
      network: "Arc Testnet",
      stats: { totalUsers, totalReviews },
      docs: "https://github.com/yournahian/Handshake",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/v1/escrows — generate API key (authenticated with wallet address)
export async function POST(req: NextRequest) {
  try {
    const { address, label } = await req.json();
    if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

    // Generate key
    const rawKey = `arch_${crypto.randomBytes(20).toString("hex")}`;
    const hash = crypto.createHash("sha256").update(rawKey).digest("hex");

    await supabaseAdmin.from("api_keys").insert({
      owner_address: address.toLowerCase(),
      key_hash: hash,
      label: label || "Default",
    });

    return NextResponse.json({
      key: rawKey,
      message: "Store this key securely — it won't be shown again.",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
