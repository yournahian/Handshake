import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export const dynamic = "force-dynamic";

// GET /api/reputation?address=0x...
export async function GET(req: NextRequest) {
  try {
    const address = req.nextUrl.searchParams.get("address")?.toLowerCase();
    if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

    const [reviewsResult, profileResult] = await Promise.all([
      supabaseAdmin
        .from("reviews")
        .select("rating")
        .eq("reviewee_address", address),
      supabaseAdmin
        .from("user_profiles")
        .select("completed_escrows, disputed_escrows")
        .eq("address", address)
        .maybeSingle(),
    ]);

    const reviews = reviewsResult.data || [];
    const profile = profileResult.data;

    const avgRating = reviews.length > 0
      ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length
      : 0;

    const completedEscrows = profile?.completed_escrows ?? 0;
    const disputedEscrows  = profile?.disputed_escrows  ?? 0;

    // Score formula
    const score = Math.max(0,
      completedEscrows * 10
      + Math.round(avgRating * 20)
      - disputedEscrows * 15
      + reviews.length * 2
    );

    // Tier
    let tier: string;
    let tierIcon: string;
    if (score < 10)       { tier = "Newcomer";  tierIcon = "🌱"; }
    else if (score < 50)  { tier = "Bronze";    tierIcon = "🥉"; }
    else if (score < 150) { tier = "Silver";    tierIcon = "🥈"; }
    else if (score < 300) { tier = "Gold";      tierIcon = "🥇"; }
    else                  { tier = "Diamond";   tierIcon = "💎"; }

    return NextResponse.json({
      address,
      score,
      tier,
      tierIcon,
      avgRating: Math.round(avgRating * 10) / 10,
      reviewCount: reviews.length,
      completedEscrows,
      disputedEscrows,
    });
  } catch (err: any) {
    console.error("[Reputation API]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
