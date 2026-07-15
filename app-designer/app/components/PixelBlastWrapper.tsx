"use client";

import dynamic from "next/dynamic";
import React, { useSyncExternalStore } from "react";

const PixelBlast = dynamic(() => import("./PixelBlast"), {
  ssr: false,
});

const subscribe = (callback: () => void) => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};

const getSnapshot = () => {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const getServerSnapshot = () => true;

export default function PixelBlastWrapper() {
  const isDark = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  return (
    <PixelBlast
      color={isDark ? "#353535" : "#d0d0d0"}
      speed={1}
      variant="square"
      pixelSize={3}
      patternScale={8}
      patternDensity={0.35}
      pixelSizeJitter={0.95}
      enableRipples
      rippleSpeed={0.4}
      rippleThickness={0.12}
      rippleIntensityScale={1.5}
      liquid={false}
      liquidStrength={0.12}
      liquidRadius={1.2}
      liquidWobbleSpeed={5}
      edgeFade={0.22}
      transparent
      windowEvents
    />
  );
}
