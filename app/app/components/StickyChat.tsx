"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useWalletConnection } from "@solana/react-hooks";
import ConnectWalletModal from "./ConnectWalletModal";

interface ChatMessage {
  id: string;
  sender: string;
  label: string;
  message: string;
  timestamp: string;
  isSelf?: boolean;
}

const DEGEN_MESSAGES = [
  "Who's ready for the Batch #2 kickoff? I went heavy on Draw.",
  "Anyone seeing the treasury yield rate? 14% APY is crazy.",
  "Joined the syndicate. LFG! 🚀",
  "Is it too late to vote on the upcoming match?",
  "Nah, voting is open until match start, plenty of time.",
  "Arsenal's current form is insane, easy win.",
  "Remember last week? Chelsea pulled that crazy comeback, don't sleep.",
  "Just connected my Phantom wallet. Let's make some profit.",
  "Who's the syndicate lead for Batch #1?",
  "I think the lead has a 82% win rate. Bullish.",
  "Let's squeeze the treasury guys, we need high consensus.",
  "Aped in 100 USDC! Let's go team!",
  "Solana gas is so cheap, voting feels so smooth compared to ETH.",
  "What's the consensus percentage right now?",
  "It's around 68%. Need a few more wallets to lock it in.",
  "Just voted! Let's hit that 75% target.",
  "Prediction is lock-in soon, double check your odds selection.",
];

const DEGEN_LABELS = [
  "Degen",
  "Whale",
  "Alpha Caller",
  "Consensus Lead",
  "Hodler",
  "Paper Hands",
  "Diamond Hands",
  "Chad",
];

const DUMMY_WALLETS = [
  "HN7c9wK2",
  "9x4yA2b1",
  "D8szK4qp",
  "Gv7tm2wL",
  "3yRex9Pq",
  "Fp2nt8Wz",
  "Bp7a45hR",
  "C9kL12dM",
  "Ek8s90fZ",
];

// Helper to generate unique color classes based on wallet string hash
const hashStringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    "text-amber-400 bg-amber-500/10 border-amber-500/20",
    "text-rose-400 bg-rose-500/10 border-rose-500/20",
    "text-sky-400 bg-sky-500/10 border-sky-500/20",
    "text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20",
    "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    "text-teal-400 bg-teal-500/10 border-teal-500/20",
  ];
  const idx = Math.abs(hash) % colors.length;
  return colors[idx];
};

export default function StickyChat() {
  const { connectors, connect, wallet, status } = useWalletConnection();
  const address = wallet?.account?.address?.toString() ?? null;
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  const [isOpen, setIsOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  // Lazy state initialization to avoid set-state-in-effect issues
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const initial: ChatMessage[] = [];
    const now = new Date();
    // Pre-populate with 8 random messages spread out in time
    for (let i = 0; i < 8; i++) {
      const minutesAgo = (8 - i) * 3;
      const timestamp = new Date(
        now.getTime() - minutesAgo * 60000
      ).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const walletAddr = DUMMY_WALLETS[i % DUMMY_WALLETS.length];
      const randomLabel = DEGEN_LABELS[i % DEGEN_LABELS.length];
      const msgText = DEGEN_MESSAGES[i % DEGEN_MESSAGES.length];

      initial.push({
        id: `init-${i}`,
        sender: `${walletAddr.substring(0, 4)}...${walletAddr.substring(4)}`,
        label: randomLabel,
        message: msgText,
        timestamp,
      });
    }
    return initial;
  });

  const [inputValue, setInputValue] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleOpenChat = () => {
    setIsOpen(true);
    setUnreadCount(0);
  };

  // Simulate incoming messages from other people periodically
  useEffect(() => {
    const interval = setInterval(() => {
      // Pick random wallet and label
      const walletAddr =
        DUMMY_WALLETS[Math.floor(Math.random() * DUMMY_WALLETS.length)];
      const randomLabel =
        DEGEN_LABELS[Math.floor(Math.random() * DEGEN_LABELS.length)];
      const msgText =
        DEGEN_MESSAGES[Math.floor(Math.random() * DEGEN_MESSAGES.length)];
      const timestamp = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const newMsg: ChatMessage = {
        id: `live-${Date.now()}`,
        sender: `${walletAddr.substring(0, 4)}...${walletAddr.substring(4)}`,
        label: randomLabel,
        message: msgText,
        timestamp,
      };

      setMessages((prev) => [...prev, newMsg]);

      // Increment unread count if the chat panel is closed
      if (!isOpen) {
        setUnreadCount((count) => count + 1);
      }
    }, 12000); // every 12 seconds

    return () => clearInterval(interval);
  }, [isOpen]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !address) return;

    const shortAddress = `${address.substring(0, 4)}...${address.slice(-4)}`;
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: shortAddress,
      label: "You",
      message: inputValue.trim(),
      timestamp,
      isSelf: true,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");

    // Simulate another degen responding to the user's message after a short delay
    setTimeout(() => {
      const responseTemplates = [
        "Aped in as well! Let's push that consensus.",
        "Nice entry! Fully agree.",
        "Bullish on your vote, let's go!",
        "Double checking the match line-up now, looks solid.",
        "Let's print some yield today! 🚀",
        "Interesting prediction, backing it up with 50 USDC.",
      ];
      const walletAddr =
        DUMMY_WALLETS[Math.floor(Math.random() * DUMMY_WALLETS.length)];
      const randomLabel =
        DEGEN_LABELS[Math.floor(Math.random() * DEGEN_LABELS.length)];
      const msgText =
        responseTemplates[Math.floor(Math.random() * responseTemplates.length)];
      const responseTime = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const responseMsg: ChatMessage = {
        id: `reply-${Date.now()}`,
        sender: `${walletAddr.substring(0, 4)}...${walletAddr.substring(4)}`,
        label: randomLabel,
        message: msgText,
        timestamp: responseTime,
      };

      setMessages((prev) => [...prev, responseMsg]);
    }, 2000);
  };

  return (
    <>
      {/* Floating Sticky Chat Button */}
      <button
        onClick={handleOpenChat}
        className="fixed right-4 bottom-38 md:bottom-8 z-40 p-4 rounded-full  bg-foreground  text-background  shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 group flex items-center justify-center cursor-pointer border border-border-low"
        aria-label="Open Syndicate Chat"
      >
        <svg
          className="w-6 h-6 transition-transform group-hover:rotate-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>

        {/* Pulsing Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Slide-In Overlay Drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-45 bg-black/60 backdrop-blur-sm"
            />

            {/* Chat Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="fixed top-0 right-0 h-full w-full sm:max-w-[400px] z-50 bg-card/90 dark:bg-black/85 backdrop-blur-xl border-l border-border-strong flex flex-col shadow-2xl font-sans"
            >
              {/* Header */}
              <div className="p-5 border-b border-border-low flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black tracking-wider text-foreground uppercase">
                    Syndicate Chat
                  </h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs text-muted font-semibold">
                      142 degens connected
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-full hover:bg-foreground/5 dark:hover:bg-white/5 text-muted hover:text-foreground transition-all cursor-pointer"
                  aria-label="Close Chat"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Messages Stream */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 select-text">
                {messages.map((msg) => {
                  const colorClasses = hashStringToColor(msg.sender);
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col gap-1 max-w-[85%] ${
                        msg.isSelf ? "ml-auto items-end" : "mr-auto items-start"
                      }`}
                    >
                      {/* Sender details */}
                      <div className="flex items-center gap-1.5 text-[10px] text-muted font-bold tracking-wide">
                        <span className="font-mono text-foreground/80">
                          {msg.sender}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full border text-[9px] font-black uppercase ${
                            msg.isSelf
                              ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
                              : colorClasses
                          }`}
                        >
                          {msg.label}
                        </span>
                        <span>•</span>
                        <span>{msg.timestamp}</span>
                      </div>

                      {/* Bubble */}
                      <div
                        className={`p-3 rounded-2xl text-sm leading-relaxed border ${
                          msg.isSelf
                            ? "bg-foreground dark:bg-white text-background dark:text-black rounded-tr-none border-foreground/10 dark:border-white/10"
                            : "bg-muted/10 border-border-low rounded-tl-none text-foreground"
                        }`}
                      >
                        {msg.message}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area / Wallet Connector Warning */}
              <div className="p-5 border-t border-border-low bg-card/90 dark:bg-black/50">
                {isConnected ? (
                  <form onSubmit={handleSendMessage} className="flex gap-2">
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder="Share predictions or trade insights..."
                      maxLength={200}
                      className="flex-1 px-4 py-3 rounded-full border border-border-low bg-background/50 text-foreground text-sm font-semibold placeholder:text-muted/60 focus:outline-none focus:border-foreground dark:focus:border-white transition-all duration-150"
                    />
                    <button
                      type="submit"
                      disabled={!inputValue.trim()}
                      className="p-3 rounded-full bg-foreground dark:bg-white text-background dark:text-black hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer flex items-center justify-center"
                      aria-label="Send message"
                    >
                      <svg
                        className="w-5 h-5 transform rotate-45 -translate-x-0.5 translate-y-0.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                        />
                      </svg>
                    </button>
                  </form>
                ) : (
                  <div className="text-center space-y-3 py-2">
                    <p className="text-xs text-muted font-bold tracking-wide">
                      Connect your wallet to join the conversation
                    </p>
                    <button
                      onClick={() => setIsConnectModalOpen(true)}
                      className="w-full py-3 px-6 rounded-full bg-foreground dark:bg-white text-background dark:text-black text-xs font-black tracking-widest uppercase hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 shadow-md cursor-pointer"
                    >
                      Connect Wallet
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Reuse global wallet connection modal for chat panel */}
      <ConnectWalletModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        connectors={connectors}
        connect={connect}
        isConnecting={isConnecting}
      />
    </>
  );
}
