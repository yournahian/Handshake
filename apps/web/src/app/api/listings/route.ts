import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!hasSupabase) {
    return NextResponse.json({ listings: [] });
  }

  try {
    const { data, error } = await supabase
      .from("open_listings")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ listings: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!hasSupabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    const { title, description, budget, creatorAddress, contactInfo, creatorRole, listingType } = await req.json();

    if (!title || !description || !budget || !creatorAddress) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Try inserting with optional metadata columns first
    let { data, error } = await supabase
      .from("open_listings")
      .insert({
        title,
        description,
        budget: parseFloat(budget),
        creator_address: creatorAddress.toLowerCase(),
        contact_info: contactInfo || "",
        status: "open",
        creator_role: creatorRole || "buyer",
        listing_type: listingType || "digital"
      })
      .select()
      .maybeSingle();

    // If extra columns do not exist in the database schema, fallback to core columns
    if (error && (error.message?.includes("column") || error.message?.includes("schema cache") || error.code === "PGRST204")) {
      console.warn("Retrying open_listings insert with core schema without extra columns:", error.message);
      const resFallback = await supabase
        .from("open_listings")
        .insert({
          title,
          description: description + (listingType === "physical" ? " [Physical Meetup]" : "") + (creatorRole ? ` [Role: ${creatorRole}]` : ""),
          budget: parseFloat(budget),
          creator_address: creatorAddress.toLowerCase(),
          contact_info: contactInfo || "",
          status: "open"
        })
        .select()
        .maybeSingle();
      data = resFallback.data;
      error = resFallback.error;
    }

    if (error) throw error;
    return NextResponse.json({ listing: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!hasSupabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    const { id, title, description, budget, creatorAddress, contactInfo, creatorRole, listingType } = await req.json();

    if (!id || !creatorAddress) {
      return NextResponse.json({ error: "Missing listing id or creator address" }, { status: 400 });
    }

    // Try full update
    let { data, error } = await supabase
      .from("open_listings")
      .update({
        title,
        description,
        budget: parseFloat(budget),
        contact_info: contactInfo || "",
        creator_role: creatorRole || "buyer",
        listing_type: listingType || "digital"
      })
      .eq("id", id)
      .eq("creator_address", creatorAddress.toLowerCase())
      .select()
      .maybeSingle();

    // Fallback if schema doesn't have extra columns
    if (error && (error.message?.includes("column") || error.message?.includes("schema cache") || error.code === "PGRST204")) {
      const resFallback = await supabase
        .from("open_listings")
        .update({
          title,
          description: description + (listingType === "physical" ? " [Physical Meetup]" : "") + (creatorRole ? ` [Role: ${creatorRole}]` : ""),
          budget: parseFloat(budget),
          contact_info: contactInfo || ""
        })
        .eq("id", id)
        .eq("creator_address", creatorAddress.toLowerCase())
        .select()
        .maybeSingle();
      data = resFallback.data;
      error = resFallback.error;
    }

    if (error) throw error;
    return NextResponse.json({ listing: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!hasSupabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const creatorAddress = searchParams.get("creatorAddress");

    if (!id || !creatorAddress) {
      return NextResponse.json({ error: "Missing listing id or creatorAddress" }, { status: 400 });
    }

    const { error } = await supabase
      .from("open_listings")
      .delete()
      .eq("id", id)
      .eq("creator_address", creatorAddress.toLowerCase());

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
