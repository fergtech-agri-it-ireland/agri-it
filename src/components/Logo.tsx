/** The silo mark, inline so it renders in every build (including the single-file demo). */
export function Logo({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#1D4D36" />
      <path d="M20 50V26c0-7 5.4-12 12-12s12 5 12 12v24z" fill="#FFC61A" />
      <rect x="20" y="36" width="24" height="4" fill="#1D4D36" />
      <rect x="20" y="44" width="24" height="4" fill="#1D4D36" />
    </svg>
  );
}
