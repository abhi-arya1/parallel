import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const kbdVariants = cva(
  "inline-flex items-center justify-center font-sans font-medium text-foreground/70 shadow-sm",
  {
    variants: {
      variant: {
        default: "border border-border/50 bg-muted/50 rounded px-1.5",
        flat: "bg-muted/80 rounded px-1.5",
        bordered: "border border-border rounded px-1.5",
      },
      size: {
        sm: "h-5 min-w-5 text-[10px] px-1",
        md: "h-6 min-w-6 text-[11px] px-1.5",
        lg: "h-7 min-w-7 text-xs px-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
);

export interface KbdProps
  extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof kbdVariants> {
  keys?: KbdKey | KbdKey[];
}

export type KbdKey =
  | "command"
  | "shift"
  | "ctrl"
  | "option"
  | "enter"
  | "delete"
  | "escape"
  | "tab"
  | "capslock"
  | "up"
  | "right"
  | "down"
  | "left"
  | "pageup"
  | "pagedown"
  | "home"
  | "end"
  | "help"
  | "space";

const keySymbols: Record<KbdKey, string> = {
  command: "\u2318",
  shift: "\u21E7",
  ctrl: "\u2303",
  option: "\u2325",
  enter: "\u23CE",
  delete: "\u232B",
  escape: "\u238B",
  tab: "\u21E5",
  capslock: "\u21EA",
  up: "\u2191",
  right: "\u2192",
  down: "\u2193",
  left: "\u2190",
  pageup: "\u21DE",
  pagedown: "\u21DF",
  home: "\u2196",
  end: "\u2198",
  help: "?",
  space: "\u2423",
};

function Kbd({ className, variant, size, keys, children, ...props }: KbdProps) {
  const renderKeys = () => {
    if (!keys) return null;
    const keyArray = Array.isArray(keys) ? keys : [keys];
    return keyArray.map((key, index) => (
      <abbr key={index} className="no-underline" title={key}>
        {keySymbols[key]}
      </abbr>
    ));
  };

  return (
    <kbd className={cn(kbdVariants({ variant, size, className }))} {...props}>
      {renderKeys()}
      {children}
    </kbd>
  );
}

export { Kbd, kbdVariants };
