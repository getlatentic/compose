// The quick-note window's icons, drawn here: importing Carbon's icon package
// brings every icon it has into this small window's bundle.
import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const BoldIcon = () => (
  <Icon strokeWidth="1.8">
    <path d="M5 3h4a2.5 2.5 0 0 1 0 5H5zM5 8h4.5a2.5 2.5 0 0 1 0 5H5z" />
  </Icon>
);

export const ItalicIcon = () => (
  <Icon>
    <path d="M7 3h5M4 13h5M9.5 3l-3 10" />
  </Icon>
);

export const CodeIcon = () => (
  <Icon>
    <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
  </Icon>
);

export const BulletListIcon = () => (
  <Icon>
    <path d="M6 4h8M6 8h8M6 12h8" />
    <circle cx="2.75" cy="4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="2.75" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="2.75" cy="12" r="0.9" fill="currentColor" stroke="none" />
  </Icon>
);

export const NumberedListIcon = () => (
  <Icon>
    <path d="M6.5 4h7.5M6.5 8h7.5M6.5 12h7.5M2 3l1-.5V6M1.75 9.25a1 1 0 0 1 2 .25c0 .75-2 1.5-2 2.5h2" />
  </Icon>
);

export const ChecklistIcon = () => (
  <Icon>
    <path d="M7 4.5h7M7 11.5h7M1.75 4.25l1.25 1.25 2.25-2.5" />
    <rect x="1.75" y="9.5" width="3.5" height="3.5" rx="0.5" />
  </Icon>
);

export const QuoteIcon = () => (
  <Icon>
    <path d="M3 4v8M6.5 5.5h7M6.5 8h7M6.5 10.5h5" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M6.5 9.5l3-3M7.5 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M8.5 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.25" />
    <path d="M10.5 5.5V3.75A1.25 1.25 0 0 0 9.25 2.5h-5.5A1.25 1.25 0 0 0 2.5 3.75v5.5a1.25 1.25 0 0 0 1.25 1.25H5.5" />
  </Icon>
);

export const IntoNoteIcon = () => (
  <Icon>
    <path d="M13 3v4.5a2 2 0 0 1-2 2H3.5M6.5 6.5l-3 3 3 3" />
  </Icon>
);

export const NewNoteIcon = () => (
  <Icon>
    <path d="M9 2.5H4.25A1.25 1.25 0 0 0 3 3.75v8.5a1.25 1.25 0 0 0 1.25 1.25h7.5A1.25 1.25 0 0 0 13 12.25V6.5zM9 2.5v4h4M8 8.5v3M6.5 10h3" />
  </Icon>
);

export const PinIcon = ({ filled = false }: { filled?: boolean }) => (
  <Icon>
    <path d="M9.5 2.5l4 4-2 1-2.5 2.5v2.5l-1 1-5-5 1-1H6.5L9 5z" fill={filled ? "currentColor" : "none"} />
    <path d="M5.5 10.5L2.5 13.5" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.75 8.5a1 1 0 0 0 1 .9h4.5a1 1 0 0 0 1-.9L12 4.5M6.75 7v4.5M9.25 7v4.5" />
  </Icon>
);

export const DocumentIcon = () => (
  <Icon>
    <path d="M9 2.5H4.25A1.25 1.25 0 0 0 3 3.75v8.5a1.25 1.25 0 0 0 1.25 1.25h7.5A1.25 1.25 0 0 0 13 12.25V6.5zM9 2.5v4h4" />
  </Icon>
);

export const TextIcon = () => (
  <Icon>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
  </Icon>
);

export const WebLinkIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c1.75 1.5 2.5 3.5 2.5 5.5S9.75 12 8 13.5M8 2.5C6.25 4 5.5 6 5.5 8s.75 4 2.5 5.5" />
  </Icon>
);
