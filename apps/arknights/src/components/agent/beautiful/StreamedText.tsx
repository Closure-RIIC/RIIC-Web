"use client";

import { memo, useState } from "react";
import styles from "./AgentMotion.module.css";

/** Reveal only newly received text; no timer invents tokens or delays completion. */
export const StreamedText = memo(function StreamedText({ text, animate = false }: { text: string; animate?: boolean }) {
  const [snapshot, setSnapshot] = useState({ text, prefix: "", tail: text, revision: 0 });
  if (snapshot.text !== text) {
    const extendsPrevious = text.startsWith(snapshot.text);
    setSnapshot({ text, prefix: extendsPrevious ? snapshot.text : "", tail: extendsPrevious ? text.slice(snapshot.text.length) : text, revision: snapshot.revision + 1 });
  }
  // Keep at most two text nodes, regardless of response length. Already received
  // text is always fully readable, even when animation frames are throttled.
  if (!animate || !snapshot.tail) return <>{text}</>;
  return <>{snapshot.prefix}<span key={snapshot.revision} className={styles.reveal} data-stream-chunk onAnimationEnd={() => {
    setSnapshot((current) => current.revision === snapshot.revision ? { ...current, prefix: current.text, tail: "" } : current);
  }}>{snapshot.tail}</span></>;
});
