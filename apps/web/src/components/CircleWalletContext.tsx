"use client";

/**
 * CircleWalletContext
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides auto-provisioned, user-controlled wallets via Circle's Programmable
 * Wallet infrastructure. When a Telegram user opens the Mini App, we
 * transparently create a Circle user + ARC-TESTNET EOA wallet for them —
 * secured by a 6-digit PIN managed by Circle's MPC backend.
 *
 * Users can later withdraw funds to MetaMask or any external address.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WalletStatus = "idle" | "loading" | "setup_required" | "ready" | "error";

interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state: string;
}

interface CircleWalletContextValue {
  status: WalletStatus;
  wallet: CircleWallet | null;
  userToken: string | null;
  encryptionKey: string | null;
  userId: string | null;
  email: string | null;
  errorMessage: string | null;

  /** Call this to trigger the Circle PIN-setup challenge (opens modal) */
  setupWallet: () => Promise<void>;

  /** Prepare + execute a contract call via Circle; returns the transaction hash */
  executeContractCall: (params: {
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: { type: string; value: string }[];
    amount?: string;
  }) => Promise<string>;

  /** Prepare + execute a USDC transfer to an external address */
  transferOut: (params: {
    destinationAddress: string;
    amount: string;       // in human-readable decimal units, e.g. "5.00"
    tokenId?: string;     // Circle USDC token ID for the chain
  }) => Promise<void>;

  /** Refresh wallet info from Circle */
  refreshWallet: () => Promise<void>;

  /** Directly execute a Circle challenge by ID (shows PIN popup) */
  executeChallenge: (challengeId: string) => Promise<any>;

  /** Log in or sign up using an email address */
  loginWithEmail: (email: string) => Promise<void>;

  /** Log out and clear the saved session */
  logout: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const CircleWalletContext = createContext<CircleWalletContextValue | null>(null);

export function useCircleWallet() {
  const ctx = useContext(CircleWalletContext);
  if (!ctx) throw new Error("useCircleWallet must be used inside <CircleWalletProvider>");
  return ctx;
}

// ─── Helper: derive a stable userId from the Telegram user ID ────────────────

function deriveTelegramUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const tg = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
    if (tg?.id) return `tg_${tg.id}`;
  } catch { /* not in Telegram */ }
  return null;
}

// Fallback: generate and persist a random userId in localStorage
function getOrCreateAnonymousUserId(): string {
  const key = "arc_circle_user_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `anon_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CircleWalletProvider({ children }: { children: React.ReactNode }) {
  const [status,        setStatus]        = useState<WalletStatus>("idle");
  const [wallet,        setWallet]        = useState<CircleWallet | null>(null);
  const [userToken,     setUserToken]     = useState<string | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);
  const [userId,        setUserId]        = useState<string | null>(null);
  const [email,         setEmail]         = useState<string | null>(null);
  const [errorMessage,  setErrorMessage]  = useState<string | null>(null);
  const sdkRef = useRef<any>(null);
  // ── Prevent React StrictMode double-invocation of the auto-login effect ──
  const initializedRef = useRef(false);
  // ── Track current status via ref so callbacks see fresh value w/o deps ──
  const statusRef = useRef<WalletStatus>("idle");

  // ── Keep statusRef in sync with state ───────────────────────────────────
  statusRef.current = status;

  // ── Load Circle W3S Web SDK lazily (client-only) ─────────────────────────
  const loadSdk = useCallback(async () => {
    if (sdkRef.current) return sdkRef.current;
    const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
    if (!appId) throw new Error("NEXT_PUBLIC_CIRCLE_APP_ID is not set");
    const sdk = new W3SSdk({ appSettings: { appId } });
    sdkRef.current = sdk;
    return sdk;
  }, []);

  // ── Execute a Circle challenge (PIN popup) ────────────────────────────────
  const executeChallenge = useCallback(async (challengeId: string): Promise<any> => {
    const sdk = await loadSdk();
    if (!userToken || !encryptionKey) throw new Error("Not authenticated with Circle");
    sdk.setAuthentication({ userToken, encryptionKey });

    return new Promise((resolve, reject) => {
      sdk.execute(challengeId, (error: any, result: any) => {
        if (error) {
          reject(new Error(`${error.code ?? "?"}: ${error.message ?? "Challenge failed"}`));
        } else {
          // result may contain { result: { type, transactionHash } }
          resolve(result);
        }
      });
    });
  }, [loadSdk, userToken, encryptionKey]);

  // ── Fetch wallets from Circle ────────────────────────────────────────────
  const fetchWallet = useCallback(async (token: string) => {
    const res = await fetch(`/api/circle/wallet?userToken=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (res.ok && data.wallets?.length > 0) {
      const w = data.wallets[0];
      setWallet({ id: w.id, address: w.address, blockchain: w.blockchain, state: w.state });
      return w;
    }
    return null;
  }, []);

  // ── Bootstrap: identify user → get Circle session → check wallet ─────────
  const bootstrap = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const uid = deriveTelegramUserId() ?? getOrCreateAnonymousUserId();
      setUserId(uid);

      // Get Circle session credentials
      const authRes = await fetch("/api/circle/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid }),
      });
      const authData = await authRes.json();
      if (!authRes.ok) throw new Error(authData.error || "Failed to authenticate with Circle");

      const { userToken: token, encryptionKey: key } = authData;
      setUserToken(token);
      setEncryptionKey(key);

      // Check if the user already has a wallet
      const existingWallet = await fetchWallet(token);
      if (existingWallet && existingWallet.state === "LIVE") {
        setStatus("ready");
      } else {
        setStatus("setup_required");
      }
    } catch (err: any) {
      console.error("[CircleWallet] Bootstrap error:", err);
      setErrorMessage(err.message || "Wallet initialization failed");
      setStatus("error");
    }
  }, [fetchWallet]);

  // ── Email Login / Registration ──────────────────────────────────────────
  const loginWithEmail = useCallback(async (email: string) => {
    // Guard: don't re-authenticate if already in progress or authenticated
    if (statusRef.current !== "idle") return;
    setStatus("loading");
    setErrorMessage(null);
    try {
      const trimmedEmail = email.toLowerCase().trim();
      // Generate deterministic 32-char hex string from the email hash (<50 characters for Circle API)
      const msgBuffer = new TextEncoder().encode(trimmedEmail);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fullHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
      const uid = `usr_${fullHash.substring(0, 32)}`;

      setUserId(uid);
      setEmail(trimmedEmail);
      localStorage.setItem("arc_circle_email", trimmedEmail);
      localStorage.setItem("arc_circle_user_id", uid);

      // Get Circle session credentials
      const authRes = await fetch("/api/circle/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid }),
      });
      const authData = await authRes.json();
      if (!authRes.ok) throw new Error(authData.error || "Failed to authenticate with Circle");

      const { userToken: token, encryptionKey: key } = authData;
      setUserToken(token);
      setEncryptionKey(key);

      // Check if the user already has a wallet
      const existingWallet = await fetchWallet(token);
      if (existingWallet && existingWallet.state === "LIVE") {
        setStatus("ready");
      } else {
        setStatus("setup_required");
      }
    } catch (err: any) {
      console.error("[CircleWallet] Email login error:", err);
      setErrorMessage(err.message || "Email login failed");
      setStatus("error");
    }
  }, [fetchWallet]);

  const logout = useCallback(() => {
    localStorage.removeItem("arc_circle_email");
    localStorage.removeItem("arc_circle_user_id");
    setUserId(null);
    setEmail(null);
    setUserToken(null);
    setEncryptionKey(null);
    setWallet(null);
    setStatus("idle");
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    // Guard against React StrictMode double-invocation
    if (initializedRef.current) return;
    initializedRef.current = true;

    const isTelegram = typeof window !== "undefined" && !!(window as any).Telegram?.WebApp?.initData;
    if (isTelegram) {
      bootstrap();
    } else {
      const savedEmail = localStorage.getItem("arc_circle_email");
      if (savedEmail) {
        loginWithEmail(savedEmail);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Setup wallet: create wallet → execute PIN challenge ──────────────────
  const setupWallet = useCallback(async () => {
    if (!userToken) { await bootstrap(); return; }
    setStatus("loading");
    try {
      const res = await fetch("/api/circle/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start wallet setup");

      await executeChallenge(data.challengeId);

      // Circle may take a moment to activate the wallet (PENDING_BLOCKCHAIN → LIVE).
      // Poll up to 12 times (1s apart) until we get a LIVE wallet.
      let liveWallet = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise(r => setTimeout(r, 1000));
        const w = await fetchWallet(userToken);
        if (w?.state === "LIVE") { liveWallet = w; break; }
      }

      if (!liveWallet) {
        // Wallet created but not yet LIVE — still mark ready so UI unblocks
        await fetchWallet(userToken);
      }
      setStatus("ready");
    } catch (err: any) {
      console.error("[CircleWallet] Setup error:", err);
      setErrorMessage(err.message || "Wallet setup failed");
      setStatus("error");
    }
  }, [userToken, bootstrap, executeChallenge, fetchWallet]);

  // ── Execute a contract call ──────────────────────────────────────────────
  const executeContractCall = useCallback(async ({
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    amount = "0",
  }: {
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: { type: string; value: string }[];
    amount?: string;
  }) => {
    if (!wallet || !userToken) throw new Error("Circle wallet not ready");

    const res = await fetch("/api/circle/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userToken,
        walletId: wallet.id,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        amount,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to prepare contract execution");

    const sdkResult = await executeChallenge(data.challengeId);

    // 1. Check the SDK result FIRST — it often returns the tx hash immediately
    //    from the Circle PIN challenge callback, no polling needed.
    const sdkHash: string =
      sdkResult?.result?.transactionHash ??
      sdkResult?.transactionHash ??
      sdkResult?.data?.transactionHash ??
      "";
    if (sdkHash && sdkHash !== "0x" && sdkHash.length > 10) {
      console.log("[executeContractCall] Got tx hash from SDK challenge result:", sdkHash);
      return sdkHash;
    }

    // 2. If the SDK didn't return a hash, wait a few seconds for Circle to index,
    //    then poll the wallet transaction list looking for our challengeId.
    //    Circle often takes 8-15s, so give it a 3s head-start then poll moderately.
    const MAX_POLL = 20;        // ~23s total with 1s intervals (~3s delay + 20 attempts)
    const POLL_DELAY = 1000;

    await new Promise((r) => setTimeout(r, 3000)); // initial buffer for Circle indexing

    for (let i = 0; i < MAX_POLL; i++) {
      try {
        const listRes = await fetch(`/api/circle/transactions?walletId=${wallet.id}&userToken=${encodeURIComponent(userToken)}`);
        if (listRes.ok) {
          const listData = await listRes.json();
          const list = listData.transactions || [];
          const matchingTx = list.find((t: any) => t.challengeId === data.challengeId);
          if (matchingTx) {
            const txHash = matchingTx.txHash;
            if (txHash && txHash !== "0x" && txHash.length > 10) {
              console.log("[executeContractCall] Found tx hash from history:", txHash);
              return txHash as string;
            }
          }
        }
      } catch (e) {
        console.warn("Error polling transactions history:", e);
      }
      await new Promise((r) => setTimeout(r, POLL_DELAY));
    }

    console.warn("[executeContractCall] Could not obtain tx hash after polling — returning fallback");
    return sdkHash;
  }, [wallet, userToken, executeChallenge]);

  // ── Transfer USDC out to an external wallet ──────────────────────────────
  const transferOut = useCallback(async ({
    destinationAddress,
    amount,
    tokenId,
  }: {
    destinationAddress: string;
    amount: string;
    tokenId?: string;
  }) => {
    if (!wallet || !userToken) throw new Error("Circle wallet not ready");

    const res = await fetch("/api/circle/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userToken, walletId: wallet.id, destinationAddress, amount, tokenId }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to prepare transfer");

    await executeChallenge(data.challengeId);
  }, [wallet, userToken, executeChallenge]);

  // ── Refresh wallet data ─────────────────────────────────────────────────
  const refreshWallet = useCallback(async () => {
    if (!userToken) return;
    await fetchWallet(userToken);
  }, [userToken, fetchWallet]);

  return (
    <CircleWalletContext.Provider
      value={{
        status,
        wallet,
        userToken,
        encryptionKey,
        userId,
        email,
        errorMessage,
        setupWallet,
        executeContractCall,
        executeChallenge,
        transferOut,
        refreshWallet,
        loginWithEmail,
        logout,
      }}
    >
      {children}
    </CircleWalletContext.Provider>
  );
}
