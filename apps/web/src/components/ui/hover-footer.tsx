"use client";
import React, { useRef, useEffect, useState } from "react";
import { motion, useInView } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Mail,
  MapPin,
  Facebook,
  Instagram,
  Twitter,
  Dribbble,
  Globe,
  Handshake,
} from "lucide-react";

export const TextHoverEffect = ({
  text,
  duration,
  className,
  cursor,
  hovered,
  inView,
}: {
  text: string;
  duration?: number;
  className?: string;
  cursor: { x: number; y: number };
  hovered: boolean;
  inView: boolean;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  // Store actual viewBox coordinates (0–1200 x, 0–100 y)
  const [maskPos, setMaskPos] = useState({ cx: 600, cy: 50 });

  useEffect(() => {
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      // Map screen px → viewBox space (1200 wide × 100 tall)
      const cx = ((cursor.x - rect.left) / rect.width) * 1200;
      const cy = ((cursor.y - rect.top) / rect.height) * 100;
      setMaskPos({ cx, cy });
    }
  }, [cursor]);

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox="0 0 1200 100"
      preserveAspectRatio="none"
      overflow="visible"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("select-none uppercase overflow-visible pointer-events-none", className)}
    >
      <defs>
        {/* Spotlight mask — cursor position in viewBox coords */}
        <motion.radialGradient
          id="revealMask"
          gradientUnits="userSpaceOnUse"
          r={240}
          initial={{ cx: 600, cy: 50 }}
          animate={maskPos}
          transition={{ duration: duration ?? 0, ease: "easeOut" }}
        >
          <stop offset="0%"   stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </motion.radialGradient>

        <linearGradient
          id="textGradient"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="1200"
          y2="0"
        >
          {hovered && (
            <>
              <stop offset="0%"   stopColor="#ffffff" />
              <stop offset="25%"  stopColor="#e5e5e5" />
              <stop offset="50%"  stopColor="#ffffff" />
              <stop offset="75%"  stopColor="#e5e5e5" />
              <stop offset="100%" stopColor="#ffffff" />
            </>
          )}
        </linearGradient>

        <mask id="textMask">
          <rect x="0" y="0" width="1200" height="100" fill="url(#revealMask)" />
        </mask>
      </defs>

      {/* Layer 1 — faint base outline (always visible) */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        strokeWidth="0.5"
        textLength="1200"
        lengthAdjust="spacingAndGlyphs"
        className="fill-transparent stroke-neutral-600 font-sans text-[80px] font-black"
        style={{ opacity: 0.25 }}
      >
        {text.toUpperCase()}
      </text>

      {/* Layer 2 — scroll-triggered stroke draw animation */}
      <motion.text
        key={inView ? "visible" : "hidden"}
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        strokeWidth="0.5"
        textLength="1200"
        lengthAdjust="spacingAndGlyphs"
        className="fill-transparent stroke-neutral-400 font-sans text-[80px] font-black"
        initial={{ strokeDashoffset: 1000, strokeDasharray: 1000, opacity: 0 }}
        animate={
          inView
            ? { strokeDashoffset: 0, strokeDasharray: 1000, opacity: 1 }
            : { strokeDashoffset: 1000, strokeDasharray: 1000, opacity: 0 }
        }
        transition={{
          duration: 4,
          ease: "easeInOut",
          opacity: { duration: 0.5 },
        }}
      >
        {text.toUpperCase()}
      </motion.text>

      {/* Layer 3 — white stroke reveal through cursor spotlight (no filter, like reference) */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        stroke="url(#textGradient)"
        strokeWidth="0.3"
        textLength="1200"
        lengthAdjust="spacingAndGlyphs"
        mask="url(#textMask)"
        className="fill-transparent font-sans text-[80px] font-black"
      >
        {text.toUpperCase()}
      </text>
    </svg>
  );
};


export const FooterBackgroundGradient = () => {
  return (
    <div
      className="absolute inset-0 z-0"
      style={{
        background:
          "radial-gradient(125% 125% at 50% 10%, #0F0F1166 50%, #ffffff0a 100%)",
      }}
    />
  );
};

export default function HoverFooter() {
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const textSectionRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(textSectionRef, { once: false, margin: "0px 0px -50px 0px" });

  const footerLinks = [
    {
      title: "Navigation",
      links: [
        { label: "OTC Escrow", href: "/escrow" },
        { label: "Physical Meetup", href: "/meetup" },
        { label: "Group Pool", href: "/treasury" },
        { label: "Create Escrow", href: "/escrow/create" },
      ],
    },
    {
      title: "Help & Resources",
      links: [
        { label: "FAQs", href: "#" },
        { label: "Support Bot", href: "https://t.me/HandshakeBot", pulse: true },
        { label: "Developer Docs", href: "#" },
      ],
    },
  ];

  const contactInfo = [
    {
      icon: <Mail size={18} className="text-neutral-400" />,
      text: "hello@handshake.com",
      href: "mailto:hello@handshake.com",
    },
    {
      icon: <MapPin size={18} className="text-neutral-400" />,
      text: "Global Settlement Network",
    },
  ];

  const socialLinks = [
    { icon: <Twitter size={20} />, label: "Twitter", href: "#" },
    { icon: <Facebook size={20} />, label: "Facebook", href: "#" },
    { icon: <Instagram size={20} />, label: "Instagram", href: "#" },
    { icon: <Dribbble size={20} />, label: "Dribbble", href: "#" },
    { icon: <Globe size={20} />, label: "Globe", href: "#" },
  ];

  return (
    <footer
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
      className="bg-[#0F0F11]/10 relative h-fit overflow-hidden border-t border-border/40 w-full"
    >
      <div className="max-w-7xl mx-auto p-14 z-40 relative">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 md:gap-8 lg:gap-16 pb-12">
          {/* Brand */}
          <div className="flex flex-col space-y-3">
            <span className="font-extrabold text-2xl tracking-tight text-white" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
              Handshake
            </span>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Autonomous escrow templates, physical meetup confirmation code hashes, and group spending limit accounting policies.
            </p>
          </div>

          {/* Nav links */}
          {footerLinks.map((section) => (
            <div key={section.title}>
              <h4 className="text-white text-lg font-semibold mb-6">{section.title}</h4>
              <ul className="space-y-3">
                {section.links.map((link) => (
                  <li key={link.label} className="relative">
                    <a href={link.href} className="hover:text-white transition-colors text-sm text-muted-foreground">
                      {link.label}
                    </a>
                    {link.pulse && (
                      <span className="absolute top-2.5 ml-2 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Contact */}
          <div>
            <h4 className="text-white text-lg font-semibold mb-6">Contact Us</h4>
            <ul className="space-y-4">
              {contactInfo.map((item, i) => (
                <li key={i} className="flex items-center space-x-3 text-sm text-muted-foreground">
                  {item.icon}
                  {item.href ? (
                    <a href={item.href} className="hover:text-white transition-colors">{item.text}</a>
                  ) : (
                    <span className="hover:text-white transition-colors">{item.text}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <hr className="border-t border-gray-800 my-8" />

        <div className="flex flex-col md:flex-row justify-between items-center text-sm space-y-4 md:space-y-0 text-muted-foreground">
          <div className="flex space-x-6 text-gray-400">
            {socialLinks.map(({ icon, label, href }) => (
              <a key={label} href={href} aria-label={label} className="hover:text-white transition-colors">
                {icon}
              </a>
            ))}
          </div>
          <p className="text-center md:text-left">
            &copy; {new Date().getFullYear()} Handshake. All rights reserved.
          </p>
        </div>
      </div>

      {/* HANDSHAKE text — scroll-triggered draw + cursor glow */}
      <div
        ref={textSectionRef}
        className="lg:flex hidden h-[30rem] -mt-52 -mb-36 z-10 w-full overflow-visible pointer-events-none"
      >
        <TextHoverEffect
          text="Handshake"
          cursor={cursor}
          hovered={hovered}
          inView={isInView}
          className="w-full h-full"
        />
      </div>

      <FooterBackgroundGradient />
    </footer>
  );
}
