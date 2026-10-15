import React from "react";

/**
 * Inline SVG icons: 16 px, 1.5 px stroke in currentColor, hidden from assistive
 * technology (the control around an icon carries the name). One stroke and one
 * weight for all, so no emoji or dingbat stands in for an icon.
 */
function Icon({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export const IconChevronLeft = (p: IconProps) => <Icon {...p}><path d="m10 3-5 5 5 5" /></Icon>;
export const IconChevronRight = (p: IconProps) => <Icon {...p}><path d="m6 3 5 5-5 5" /></Icon>;
export const IconSort = (p: IconProps) => <Icon {...p}><path d="m5 5 3-3 3 3M5 11l3 3 3-3" /></Icon>;
export const IconSortUp = (p: IconProps) => <Icon {...p}><path d="m4 9 4-4 4 4" /></Icon>;
export const IconSortDown = (p: IconProps) => <Icon {...p}><path d="m4 7 4 4 4-4" /></Icon>;

export const IconKeyboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.75" y="4" width="12.5" height="8" rx="1.5" />
    <path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5 9.5h6" />
  </Icon>
);

export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13.25h10" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3.25 8.5 3 3 6.5-7" />
  </Icon>
);

export const IconRetry = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 8a5 5 0 1 1-1.6-3.67M13 2.75v2.5h-2.5" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);

export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.5 3 13 5.5 6 12.5 3 13l.5-3z" />
  </Icon>
);

export const IconQuestion = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6.25a2 2 0 1 1 2.75 1.85c-.45.2-.75.62-.75 1.1v.55M8 12h.01" />
  </Icon>
);

export const IconUndo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 6.5H10a3 3 0 0 1 0 6H6.5M7.5 4 5 6.5 7.5 9" />
  </Icon>
);

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />
  </Icon>
);

export const IconWarning = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5 14 13H2zM8 6.5v3M8 11.25h.01" />
  </Icon>
);

export const IconDocument = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 1.75h5.5L12.5 4.75v9.5H4zM9.5 1.75v3h3M6 8h4.5M6 10.5h4.5" />
  </Icon>
);
