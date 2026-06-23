// v7.1.8: Renamed from ManusDialog — no more leftover Manus branding
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

interface AndromedaDialogProps {
  title?: string;
  logo?: string;
  open?: boolean;
  onLogin: () => void;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
}

/** @deprecated Use AndromedaDialog directly */
export type ManusDialogProps = AndromedaDialogProps;

export function AndromedaDialog({
  title,
  logo,
  open = false,
  onLogin,
  onOpenChange,
  onClose,
}: AndromedaDialogProps) {
  const [internalOpen, setInternalOpen] = useState(open);

  useEffect(() => {
    if (!onOpenChange) {
      setInternalOpen(open);
    }
  }, [open, onOpenChange]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(nextOpen);
    } else {
      setInternalOpen(nextOpen);
    }
    if (!nextOpen) {
      onClose?.();
    }
  };

  return (
    <Dialog
      open={onOpenChange ? open : internalOpen}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className="py-5 bg-[#0f0f0f] rounded-[20px] w-[400px] shadow-[0px_4px_32px_0px_rgba(0,0,0,0.4)] border border-[rgba(255,255,255,0.08)] backdrop-blur-2xl p-0 gap-0 text-center">
        <div className="flex flex-col items-center gap-2 p-5 pt-12">
          {logo ? (
            <div className="w-16 h-16 bg-card rounded-xl border border-border/40 flex items-center justify-center">
              <img
                src={logo}
                alt="Andromeda"
                className="w-10 h-10 rounded-md"
                style={{ filter: "invert(1) brightness(0.85)" }}
              />
            </div>
          ) : null}

          {title ? (
            <DialogTitle className="text-xl font-semibold text-foreground leading-[26px] tracking-[-0.44px]">
              {title}
            </DialogTitle>
          ) : null}
          <DialogDescription className="text-sm text-muted-foreground leading-5 tracking-[-0.154px]">
            Sign in to continue using Andromeda
          </DialogDescription>
        </div>

        <DialogFooter className="px-5 py-5">
          <Button
            onClick={onLogin}
            className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-[10px] text-sm font-medium leading-5 tracking-[-0.154px]"
          >
            Sign in to Andromeda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Backward-compat alias — prefer AndromedaDialog */
export const ManusDialog = AndromedaDialog;
