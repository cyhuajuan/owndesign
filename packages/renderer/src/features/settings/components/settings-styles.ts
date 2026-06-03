import { cn } from "@/lib/utils";

export function settingsOptClass(active: boolean) {
  return cn(
    "flex-1 rounded-[6px] border border-[#2a2a2e] bg-[#0a0a0b] px-3 py-2 text-center text-[13px] text-[#a0a0ab] transition-all duration-150 hover:border-[#38383d] hover:text-[#f0f0f2]",
    active &&
      "border-[#6c5ce7] bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] hover:border-[#6c5ce7] hover:bg-[rgba(108,92,231,0.15)] hover:text-[#6c5ce7]",
  );
}
