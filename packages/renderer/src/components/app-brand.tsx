import { LayersIcon } from "lucide-react";

export function AppBrand() {
  return (
    <div className="flex shrink-0 items-center gap-2 font-semibold text-primary">
      <LayersIcon className="size-5" />
      <span className="text-[15px] tracking-normal">OwnDesign</span>
    </div>
  );
}
