"use client";

/**
 * MobileNav
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders:
 *  • Desktop (≥ 768px): the existing sticky top header with logo + nav + wallet
 *  • Mobile  (< 768px): a fixed bottom tab bar with icon tabs + wallet at top
 *
 * The bottom tab bar has 4 main tabs: Home, OTC Escrow, Physical, Group Pool.
 * It hides the HoverFooter in TG mode (handled via globals.css data-tg selector).
 */

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShieldCheck, QrCode, Landmark, Globe, Handshake } from "lucide-react";
import { HeaderWallet } from "@/components/HeaderWallet";
import { NotificationBell } from "@/components/NotificationBell";

const NAV_TABS = [
  { href: "/",              label: "Home",    icon: Home },
  { href: "/escrow",        label: "OTC",     icon: ShieldCheck },
  { href: "/meetup",        label: "Meetup",  icon: QrCode },
  { href: "/treasury",      label: "Pool",    icon: Landmark },
  { href: "/escrow/board",  label: "Board",   icon: Globe },
];

export function MobileNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* ── Desktop Header ────────────────────────────────────────────────── */}
      <header
        className="main-header desktop-header"
        style={{ boxShadow: scrolled ? "0 2px 20px rgba(0,0,0,0.4)" : "none" }}
      >
        <Link href="/" className="header-logo" style={{ textDecoration: "none" }}>
          <span style={{
            fontSize: "1.35rem",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: "var(--text-primary)",
            fontFamily: "Space Grotesk, sans-serif"
          }}>
            Handshake
          </span>
        </Link>

        <nav className="main-nav">
          <Link href="/escrow"       className={`nav-link ${isActive("/escrow")       ? "nav-link-active" : ""}`}>OTC Escrow</Link>
          <Link href="/meetup"       className={`nav-link ${isActive("/meetup")       ? "nav-link-active" : ""}`}>Physical Escrow</Link>
          <Link href="/treasury"     className={`nav-link ${isActive("/treasury")     ? "nav-link-active" : ""}`}>Group Pool</Link>
          <Link href="/escrow/board" className={`nav-link ${isActive("/escrow/board") ? "nav-link-active" : ""}`}>Board</Link>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <NotificationBell />
          <HeaderWallet />
        </div>
      </header>

      {/* ── Mobile Top Bar (wallet only) ──────────────────────────────────── */}
      <div className="mobile-top-bar">
        <Link href="/" className="header-logo" style={{ textDecoration: "none" }}>
          <span style={{
            fontSize: "1.15rem",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: "var(--text-primary)",
            fontFamily: "Space Grotesk, sans-serif"
          }}>
            Handshake
          </span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <NotificationBell />
          <HeaderWallet />
        </div>
      </div>

      {/* ── Mobile Bottom Tab Bar ─────────────────────────────────────────── */}
      <nav className="bottom-tab-bar" aria-label="Main navigation">
        {NAV_TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={`bottom-tab ${active ? "bottom-tab-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="bottom-tab-icon">
                <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                {active && <span className="bottom-tab-dot" />}
              </span>
              <span className="bottom-tab-label">{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
