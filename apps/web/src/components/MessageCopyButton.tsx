import { useEffect, useState } from "react";

interface Props {
  text: string;
}

export function MessageCopyButton({ text }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
      className="flex h-7 w-7 items-center justify-center rounded-full text-mk-tide transition-colors hover:bg-mk-ridge hover:text-mk-crest"
      aria-label={copied ? "Copied message" : "Copy message"}
      title={copied ? "Copied" : "Copy message"}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <rect
        x="4"
        y="4"
        width="8.5"
        height="8.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M9.5 2.5H4.5A.5.5 0 0 0 4 3v.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M2.5 9.5V3.5A1 1 0 0 1 3.5 2.5h4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
