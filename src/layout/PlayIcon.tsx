export function PlayIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M6 3l10 7-10 7z" />
  </svg>;
}

export function PauseIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M5 4h3v12H5zM12 4h3v12h-3z" />
  </svg>;
}

export function StepIcon({ direction }: { direction: 'previous' | 'next' }) {
  return <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d={direction === 'next' ? 'M15 4h2v12h-2zM3 3l10 7-10 7z' : 'M3 4h2v12H3zM17 3v14L7 10z'} />
  </svg>;
}

export function RestartIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
    <path d="M3 5v5h5M3 10a7 7 0 1 1 2 5" />
  </svg>;
}
