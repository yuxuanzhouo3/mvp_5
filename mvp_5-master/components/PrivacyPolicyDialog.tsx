"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrivacyPolicyContent } from "@/components/legal";

interface PrivacyPolicyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDomestic: boolean;
}

export function PrivacyPolicyDialog({ open, onOpenChange, isDomestic }: PrivacyPolicyDialogProps) {
  const title = isDomestic ? "隐私条款" : "Privacy Policy";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] bg-white dark:bg-[#2d2d30] border-gray-200 dark:border-[#565869] shadow-2xl rounded-2xl">
        <DialogHeader className="pb-3 border-b border-gray-100 dark:border-[#565869]">
          <DialogTitle className="text-lg font-bold text-gray-900 dark:text-[#ececf1]">
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="h-[calc(85vh-100px)] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent">
          <PrivacyPolicyContent isDomestic={isDomestic} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
