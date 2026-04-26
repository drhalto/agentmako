interface Props {
  onClick(): void;
  disabled?: boolean;
}

export function MessageEditButton({ onClick, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Edit message and roll back"
      title="Edit and roll back — archives this message and everything after, then lets you resend"
      className="flex h-7 w-7 items-center justify-center rounded-full text-mk-tide transition-colors hover:bg-mk-ridge hover:text-mk-crest disabled:cursor-not-allowed disabled:opacity-40"
    >
      <PencilIcon />
    </button>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M10.5 3L13 5.5M10.5 3L4 9.5V12H6.5L13 5.5M10.5 3L13 5.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
