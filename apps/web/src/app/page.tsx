"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { DotGlobeHero } from "@/components/ui/globe-hero";
import { 
  ArrowRight, 
  Zap, 
  ChevronDown, 
  ShieldCheck, 
  QrCode, 
  Layers, 
  Landmark, 
  Handshake, 
  Cpu, 
  Wallet 
} from "lucide-react";

// FAQ Item Accordion component using Tailwind CSS
function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div 
      onClick={() => setIsOpen(!isOpen)}
      className="border-b border-border/40 py-5 cursor-pointer text-left transition-colors hover:bg-card/10 px-2 rounded-lg"
    >
      <div className="flex justify-between items-center">
        <h4 className={`text-base font-semibold transition-colors duration-200 ${isOpen ? "text-primary" : "text-foreground"}`}>
          {question}
        </h4>
        <ChevronDown 
          size={18} 
          className={`text-muted-foreground transition-transform duration-300 ${isOpen ? "rotate-180" : "rotate-0"}`} 
        />
      </div>
      {isOpen && (
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-2xl">
          {answer}
        </p>
      )}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseInt(searchInput.trim());
    if (!isNaN(id) && id > 0) {
      router.push(`/escrow/${id}`);
    } else {
      alert("Please enter a valid numeric Escrow Job ID");
    }
  };

  return (
    <div className="w-full bg-background text-foreground flex flex-col gap-16 sm:gap-28 pb-4 sm:pb-20 overflow-hidden">
      
      {/* Hero Section using DotGlobeHero */}
      <DotGlobeHero
        rotationSpeed={0.003}
        globeRadius={1.1}
        className="bg-gradient-to-br from-background via-background/95 to-muted/10 relative overflow-hidden min-h-[90vh] sm:min-h-[85vh] py-12 sm:py-20 golden-horizon-divider"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-background/30" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-primary/3 rounded-full blur-3xl animate-pulse" />
        
        <div className="relative z-10 text-center space-y-6 sm:space-y-10 max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-6"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative inline-flex items-center gap-3 px-5 py-2.5 rounded-full bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 border border-primary/20 backdrop-blur-xl shadow-2xl"
            >
              <div className="absolute inset-0 rounded-full bg-gradient-to-r from-primary/5 via-transparent to-primary/5 animate-pulse" />
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-ping" />
              <span className="relative z-10 text-xs font-bold text-primary tracking-widest uppercase">ESCROW SYSTEM</span>
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-ping animation-delay-500" />
            </motion.div>
            
            <div className="space-y-4">
              <motion.h1 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1, delay: 0.3 }}
                className="text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-[1.1] sm:leading-[0.9] select-none"
                style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
              >
                <span className="block font-light text-foreground/75 mb-2 text-xl sm:text-4xl lg:text-6xl">
                  Build Real-World
                </span>
                <span className="block relative mt-4">
                  <span 
                    className="font-black relative z-10 uppercase select-none tracking-tighter"
                    style={{
                      WebkitTextStroke: "1.5px hsl(var(--primary))",
                      WebkitTextFillColor: "transparent",
                      color: "transparent",
                    }}
                  >
                    Finance Onchain
                  </span>
                  <div 
                    className="absolute inset-0 font-black blur-xl opacity-35 scale-105 uppercase select-none tracking-tighter"
                    style={{
                      WebkitTextStroke: "1.5px hsla(var(--primary), 0.6)",
                      WebkitTextFillColor: "transparent",
                      color: "transparent",
                    }}
                  >
                    Finance Onchain
                  </div>
                  {/* Animated underline bar — matching reference image */}
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 1.5, delay: 1.2, ease: "easeOut" }}
                    className="absolute -bottom-5 left-0 h-[6px] bg-gradient-to-r from-white via-white/90 to-white/10 rounded-full shadow-[0_0_20px_6px_rgba(255,255,255,0.5),0_0_40px_10px_rgba(255,255,255,0.2)]"
                  />
                </span>
              </motion.h1>
            </div>
            
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="max-w-3xl mx-auto space-y-4"
            >
              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed font-medium">
                Handshake provides secure, trustless escrow templates and joint treasury tools. Manage payments with{" "}
                <span className="text-foreground font-semibold bg-gradient-to-r from-primary/10 to-primary/5 px-2 py-1 rounded-md border border-primary/10">
                  AI verification, QR codes, and group accountant policies
                </span>.
              </p>
            </motion.div>
          </motion.div>

          {/* Escrow Search Input Bar inside the Hero */}
          <motion.form 
            onSubmit={handleQuickSearch} 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="flex w-full max-w-lg bg-card/60 backdrop-blur-xl border border-border/40 rounded-full p-1.5 shadow-2xl mx-auto relative z-20 hover:border-primary/30 transition-all"
          >
            <input
              type="number"
              placeholder="Escrow Job ID (e.g. 6)"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              min="1"
              className="bg-transparent border-none px-4 sm:px-5 py-2 text-foreground focus:outline-none focus:ring-0 w-full text-sm font-medium"
              style={{ fontSize: "16px" }}
            />
            <button type="submit" className="px-4 sm:px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-full hover:bg-primary/95 transition-all text-xs uppercase tracking-wider whitespace-nowrap">
              Open
            </button>
          </motion.form>

          {/* Action CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.9 }}
            className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center pt-2 w-full sm:w-auto px-4 sm:px-0"
          >
            <Link href="/escrow/create" className="no-underline w-full sm:w-auto">
              <motion.div
                whileHover={{ 
                  scale: 1.03, 
                  boxShadow: "0 10px 25px rgba(0,0,0,0.2), 0 0 15px hsl(var(--primary) / 0.25)",
                  y: -1
                }}
                whileTap={{ scale: 0.98 }}
                className="group relative inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-3.5 bg-primary text-primary-foreground rounded-lg font-semibold text-sm shadow-xl transition-all duration-300 overflow-hidden border border-primary/20 cursor-pointer"
              >
                <span className="relative z-10 tracking-wider uppercase">Create Escrow</span>
                <ArrowRight className="relative z-10 w-4 h-4 group-hover:translate-x-1 transition-transform duration-300" />
              </motion.div>
            </Link>
            
            <Link href="/treasury" className="no-underline w-full sm:w-auto">
              <motion.div
                whileHover={{ 
                  scale: 1.03,
                  borderColor: "hsl(var(--primary) / 0.4)",
                  backgroundColor: "rgba(255, 255, 255, 0.03)",
                  y: -1
                }}
                whileTap={{ scale: 0.98 }}
                className="group relative inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-3.5 border border-border/50 rounded-lg font-semibold text-sm transition-all duration-300 backdrop-blur-xl bg-background/30 hover:bg-background/80 shadow-lg cursor-pointer"
              >
                <Zap className="relative z-10 w-4 h-4 text-primary group-hover:scale-110 transition-all duration-300" />
                <span className="relative z-10 tracking-wider uppercase text-foreground">Group Pools</span>
              </motion.div>
            </Link>
          </motion.div>
        </div>
      </DotGlobeHero>

      {/* Core Use Cases Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 w-full flex flex-col gap-8 sm:gap-12">
        <div className="text-center space-y-2">
          <span className="text-xs text-primary font-mono uppercase tracking-widest font-bold">Three Core Frameworks</span>
          <h2 className="text-xl sm:text-4xl font-extrabold tracking-tight">Purpose-built to support real-world financial flows</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Card 1: OTC Escrow */}
          <div className="bg-card border border-border/40 rounded-xl p-8 flex flex-col gap-6 hover:border-primary/30 transition-all relative group">
            {/* Illustration: AI Status Toggle */}
            <div className="h-32 w-full bg-primary/5 border border-border/40 rounded-lg flex items-center justify-center relative overflow-hidden">
              <div className="bg-background border border-border/60 rounded-lg p-4 w-[85%] flex flex-col gap-2.5 text-left shadow-lg">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground font-mono uppercase">AI AGENT STATE</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-foreground">Gemini Verification</span>
                  <div className="w-8 h-4.5 rounded-full bg-primary relative cursor-pointer">
                    <div className="w-3.5 h-3.5 rounded-full bg-white absolute right-0.5 top-0.5"></div>
                  </div>
                </div>
                <div className="flex gap-1.5 items-center text-[10px] text-emerald-500">
                  <ShieldCheck size={12} />
                  <span>Scan active & listening</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-foreground">Digital OTC Escrows</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Secure online transactions, asset trades, and gig milestones. Deliverables are uploaded to cloud buckets, validated by Gemini AI, and held under secure visual watermark overlays until funds release.
              </p>
            </div>
            <Link href="/escrow" className="text-primary font-semibold text-xs no-underline inline-flex items-center gap-1.5 hover:underline mt-auto">
              Enter OTC Portal <ArrowRight size={14} />
            </Link>
          </div>

          {/* Card 2: Physical Meetup */}
          <div className="bg-card border border-border/40 rounded-xl p-8 flex flex-col gap-6 hover:border-primary/30 transition-all relative group">
            {/* Illustration: QR scan frame */}
            <div className="h-32 w-full bg-primary/5 border border-border/40 rounded-lg flex items-center justify-center relative overflow-hidden">
              <div className="flex flex-col items-center gap-2">
                <div className="relative p-2.5 bg-background border border-border/60 rounded-lg">
                  <QrCode size={48} className="text-primary" />
                  {/* Scanning indicator line */}
                  <div className="absolute left-2.5 right-2.5 h-0.5 bg-primary top-1/2 shadow-[0_0_8px_rgba(255,255,255,0.8)] animate-pulse"></div>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground uppercase">Dual-Signature QR</span>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-bold text-foreground">In-Person Meetups</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Meet locally to swap physical assets, gear, and goods safely. The buyer locks funds on-chain, generates a secure release QR code, and letting the seller scan it in person to complete the transaction instantly.
              </p>
            </div>
            <Link href="/meetup" className="text-primary font-semibold text-xs no-underline inline-flex items-center gap-1.5 hover:underline mt-auto">
              Enter Meetup Portal <ArrowRight size={14} />
            </Link>
          </div>

          {/* Card 3: Group Pool */}
          <div className="bg-card border border-border/40 rounded-xl p-8 flex flex-col gap-6 hover:border-primary/30 transition-all relative group">
            {/* Illustration: Spend allowance controller */}
            <div className="h-32 w-full bg-primary/5 border border-border/40 rounded-lg flex items-center justify-center relative overflow-hidden">
              <div className="bg-background border border-border/60 rounded-lg p-4 w-[85%] flex flex-col gap-2 text-left shadow-lg">
                <span className="text-[10px] text-muted-foreground font-mono uppercase">MICRO-ALLOWANCE LIMIT</span>
                <div className="flex justify-between items-baseline">
                  <span className="text-sm font-bold font-mono text-foreground">250.00 <span className="text-[10px] text-primary">USDC</span></span>
                </div>
                <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="w-[65%] h-full bg-primary rounded-full"></div>
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>Used: 162 USDC</span>
                  <span>Daily Limit</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-bold text-foreground">Group Treasuries</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Pool funds with co-workers, friends, or DAOs. Configure daily or weekly limits for fast automated micro-spending, propose larger escrow allocations, and vote on-chain inside your Telegram chat.
              </p>
            </div>
            <Link href="/treasury" className="text-primary font-semibold text-xs no-underline inline-flex items-center gap-1.5 hover:underline mt-auto">
              Enter Treasury Portal <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 w-full">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-8 border-y border-border/40 bg-card/10 rounded-xl px-4 sm:px-8 items-center">
          <div className="text-left space-y-1">
            <span className="text-[10px] text-primary font-mono uppercase tracking-widest font-bold">Public Settlement</span>
            <h3 className="text-lg font-bold">Decentralized Network</h3>
          </div>
          <div className="text-left">
            <div className="text-2xl sm:text-3xl font-bold font-mono text-foreground">~0.48s</div>
            <div className="text-xs text-muted-foreground mt-1">Average Block Time</div>
          </div>
          <div className="text-left">
            <div className="text-2xl sm:text-3xl font-bold font-mono text-foreground">$0.01</div>
            <div className="text-xs text-muted-foreground mt-1">Target Base Fee (USDC)</div>
          </div>
          <div className="text-left">
            <div className="text-2xl sm:text-3xl font-bold font-mono text-foreground">100%</div>
            <div className="text-xs text-muted-foreground mt-1">Deterministic Finality</div>
          </div>
        </div>
      </section>

      {/* Developer Grid Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 w-full flex flex-col gap-8 sm:gap-12 border-t border-border/20 pt-10 sm:pt-16">
        <div className="flex justify-between items-end flex-wrap gap-6">
          <div className="text-left space-y-2">
            <span className="text-xs text-primary font-mono uppercase tracking-widest font-bold">Autonomous Protocol</span>
            <h2 className="text-xl sm:text-4xl font-extrabold tracking-tight">Real economic activity unleashed</h2>
          </div>
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            Handshake harnesses custom ERC-8183 templates and instant deterministic settlement finality to support complex business workflows without centralized risk.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              num: "01",
              title: "OTC Settlements",
              desc: "Deploy trustless escrow contracts with customized timeout thresholds, provider wallets, and arbitrator overrides."
            },
            {
              num: "02",
              title: "Gemini AI Verification",
              desc: "Autonomous bot listener intercepts uploaded deliverables and runs AI verification scans against specs before authorizing payouts."
            },
            {
              num: "03",
              title: "Meetup QR Finality",
              desc: "Dual-signature verification linking hashed release secrets to physical meetup confirmations for local asset trades."
            },
            {
              num: "04",
              title: "Shared Pools",
              desc: "Consolidate joint accounts with multisig proposal mechanisms, membership indices, and automated voting."
            },
            {
              num: "05",
              title: "Micro Allowances",
              desc: "Implement automated daily spending budgets allowing trusted members to request payouts without manual multisig cycles."
            },
            {
              num: "06",
              title: "Sub-Second Processing",
              desc: "Leverage deterministic block times to resolve disputes, update balances, and settle transactions in sub-second speeds."
            }
          ].map((item, idx) => (
            <div 
              key={idx} 
              className="bg-card border border-border/40 p-6 rounded-xl flex flex-col gap-3 hover:border-primary/20 transition-all text-left"
            >
              <div className="text-primary font-mono text-xs font-bold tracking-widest">{item.num}</div>
              <h4 className="text-base font-bold text-foreground">{item.title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ Section */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 w-full flex flex-col gap-6 sm:gap-10 border-t border-border/20 pt-10 sm:pt-16">
        <div className="text-center space-y-2">
          <span className="text-xs text-primary font-mono uppercase tracking-widest font-bold">Frequently Asked Questions</span>
          <h2 className="text-xl sm:text-4xl font-extrabold tracking-tight">FAQ</h2>
        </div>

        <div className="flex flex-col gap-2">
          <FaqItem 
            question="How does AI-Verification work?" 
            answer="When a provider uploads their work (e.g., an SVG vector file) inside the web interface or replies to the Telegram bot with '#submit', the bot uses the Gemini Vision model to check if the file matches the buyer's description. If it matches, the bot automatically executes the complete transaction on-chain." 
          />
          <FaqItem 
            question="What is the role of the Arbitrator?" 
            answer="Every escrow has a designated Evaluator/Arbitrator address. By default, it is the bot's wallet, which resolves settlements automatically. Users can also configure a custom address (e.g. the buyer's wallet for web-only manual confirmations), which gives the arbitrator the option to Resolve Disputes by refunding the buyer, paying the seller, or performing a 50/50 split." 
          />
          <FaqItem 
            question="How are physical meetup trades protected?" 
            answer="For in-person swaps, a release code is generated on-chain from a secret word provided by the buyer. When the buyer inspects the goods in person and is satisfied, they let the seller scan the QR code. Scanning the QR code inputs the secret confirmation code into the smart contract, which instantly releases the USDC on-chain." 
          />
          <FaqItem 
            question="Are funds safe if the verification backend is offline?" 
            answer="Yes! All funds are held in the smart contract itself, not on our servers. Even if the Telegram bot or database goes offline, the buyer can always approve the release or file a dispute directly on-chain using the web interface, or wait for the contract expiration to trigger a refund." 
          />
        </div>
      </section>

    </div>
  );
}
