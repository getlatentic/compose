/**
 * The Compose brand mark — a pencil + bloom (write = compose, the bloom marks
 * the AI thread). The cyan glyph is meant to sit on the dark brand tile, so it
 * matches the app icon and favicon. Sized like a Carbon icon via `size`.
 */
export function ComposeMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="#00E5FF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15.4 4.6a2 2 0 0 1 2.8 2.8L8 17.6l-3.8 1 1-3.8Z" />
        <path d="M13.5 6.5l2.8 2.8" />
      </g>
      <g fill="#5CF2FF">
        <circle cx="16.2" cy="17.4" r="1.7" />
        <circle cx="19.6" cy="17.4" r="1.7" />
        <circle cx="17.9" cy="15.7" r="1.7" />
        <circle cx="17.9" cy="19.1" r="1.7" />
      </g>
      <circle cx="17.9" cy="17.4" r="1" fill="#0F1419" />
    </svg>
  );
}
