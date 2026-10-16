import { buildLabel, releaseLine } from '../lib/release';

/** The release version and credit, small and grey at the foot of every screen. */
export function ReleaseLine({ className = '' }: { className?: string }) {
  const build = buildLabel();
  return (
    <footer className={`px-4 pb-2 pt-6 text-center text-[0.75rem] text-muted ${className}`} data-release>
      <p>{releaseLine()}</p>
      {build && <p className="mt-0.5 opacity-80">{build}</p>}
    </footer>
  );
}
