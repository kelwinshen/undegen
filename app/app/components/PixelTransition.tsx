"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "motion/react";
import Image from "next/image";
import logoOnly from "../assets/logo-only.png";

// Grid configuration
const COLS = 24;
const ROWS = 16;
const TOTAL_BLOCKS = COLS * ROWS;

// Outro timing configuration
const OUTRO_TIMEOUT = 800; // ms to wait before pushing the route
const INTRO_IDLE_TIMEOUT = 1000; // ms before setting transition to idle

type TransitionPhase = "intro" | "outro" | "idle";

const blockVariants = {
  introInitial: {
    backgroundColor: "var(--background)",
    scale: 1.02,
    opacity: 1,
  },
  introAnimate: (custom: { delay: number }) => ({
    backgroundColor: [
      "var(--background)",
      "var(--background)",
      "var(--background)",
      "rgba(255, 255, 255, 0)",
    ],
    scale: [1.02, 1.02, 0.7, 0],
    opacity: [1, 1, 1, 0],
    transition: {
      duration: 1,
      delay: custom.delay,
      times: [0, 0.25, 0.5, 1],
      ease: "easeInOut" as const,
    },
  }),
  outroInitial: {
    backgroundColor: "rgba(255, 255, 255, 0)",
    scale: 0,
    opacity: 0,
  },
  outroAnimate: (custom: { delay: number }) => ({
    backgroundColor: [
      "rgba(255, 255, 255, 0)",
      "var(--background)",
      "var(--background)",
      "var(--background)",
    ],
    scale: [0, 0.7, 1.02, 1.02],
    opacity: [0, 1, 1, 1],
    transition: {
      duration: 1,
      delay: custom.delay,
      times: [0, 0.25, 0.5, 1],
      ease: "easeInOut" as const,
    },
  }),
  idle: {
    backgroundColor: "rgba(255, 255, 255, 0)",
    scale: 0,
    opacity: 0,
  },
};

export default function PixelTransition() {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<TransitionPhase>("intro");


  // Generate stable transition delays for each block in the grid
  const blocks = useMemo(() => {
    return Array.from({ length: TOTAL_BLOCKS }).map((_, index) => {
      const col = index % COLS;
      const row = Math.floor(index / COLS);

      // Calculate normalized position for a diagonal wave effect (top-left to bottom-right)
      const normalizedPos = (col + row) / (COLS + ROWS);
      const baseDelay = normalizedPos * 0.25;

      // Add pseudo-random noise to make it look pixelated
      const randomNoise = Math.sin(index * 9.8) * 0.08 + 0.08;

      return {
        index,
        delay: baseDelay + randomNoise,
      };
    });
  }, []);

  // Track pathname changes to trigger the intro transition
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setPhase("intro");
  }

  // Set phase to idle after intro completes so page is fully interactive
  useEffect(() => {
    if (phase === "intro") {
      const timer = setTimeout(() => {
        setPhase("idle");
      }, INTRO_IDLE_TIMEOUT);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  // Intercept all internal Link clicks globally
  useEffect(() => {
    const handleLinkClick = (e: MouseEvent) => {
      // Find closest anchor tag
      let target = e.target as HTMLElement | null;
      while (target && target.tagName !== "A") {
        target = target.parentElement;
      }

      if (!target || target.tagName !== "A") return;

      const href = target.getAttribute("href");
      const targetAttr = target.getAttribute("target");

      // Check if it's a valid local internal route
      if (
        href &&
        href.startsWith("/") &&
        !href.startsWith("//") &&
        targetAttr !== "_blank" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey &&
        e.button === 0 // Left click only
      ) {
        const currentPath = window.location.pathname;
        if (currentPath === href) {
          // If already on the page, let it be or refresh
          return;
        }

        // Prevent default browser navigation
        e.preventDefault();

        setPhase("outro");

        // Push new route after screen is covered in black
        setTimeout(() => {
          router.push(href);
        }, OUTRO_TIMEOUT);
      }
    };

    // Use capture phase to intercept clicks before Next.js Router handles them
    document.addEventListener("click", handleLinkClick, true);
    return () => {
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [router]);

  return (
    <>
      <div
        className={`fixed inset-0 grid w-screen h-screen z-9999 overflow-hidden ${
          phase === "outro" ? "pointer-events-auto" : "pointer-events-none"
        }`}
        style={{
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        }}
      >
        {blocks.map((block) => (
          <motion.div
            key={block.index}
            custom={{ delay: block.delay }}
            variants={blockVariants}
            initial={phase === "intro" ? "introInitial" : "outroInitial"}
            animate={
              phase === "intro"
                ? "introAnimate"
                : phase === "outro"
                  ? "outroAnimate"
                  : "idle"
            }
            className="w-full h-full relative"
          />
        ))}
      </div>

      {phase === "outro" && (
        <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center pointer-events-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
              opacity: [0, 0.8, 0.4, 0.8],
              scale: [0.8, 1, 0.95, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
              times: [0, 0.3, 0.65, 1],
            }}
            className="flex items-center justify-center"
          >
            <Image
              src={logoOnly}
              alt="Loading..."
              width={80}
              height={80}
              priority
              className="object-contain"
            />
          </motion.div>

        </div>
      )}
    </>
  );
}
