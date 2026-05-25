"use client";

import { createContext, useContext, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";

type ToolApproval = NonNullable<
  Extract<ToolUIPart | DynamicToolUIPart, { approval?: unknown }>["approval"]
>;

type ToolApprovalState = (ToolUIPart | DynamicToolUIPart)["state"];

type ConfirmationContextValue = {
  approval: ToolApproval;
  state: ToolApprovalState;
};

const ConfirmationContext =
  createContext<ConfirmationContextValue | null>(null);

export type ConfirmationProps = ComponentProps<"div"> & {
  approval?: ToolApproval;
  state: ToolApprovalState;
};

export function Confirmation({
  approval,
  children,
  className,
  state,
  ...props
}: ConfirmationProps) {
  if (!approval || state === "input-streaming" || state === "input-available") {
    return null;
  }

  return (
    <ConfirmationContext.Provider value={{ approval, state }}>
      <div
        className={cn(
          "not-prose rounded-md border border-border bg-muted/30 p-3 text-sm",
          className,
        )}
        role="alert"
        {...props}
      >
        {children}
      </div>
    </ConfirmationContext.Provider>
  );
}

export type ConfirmationTitleProps = ComponentProps<"div">;

export function ConfirmationTitle({
  className,
  ...props
}: ConfirmationTitleProps) {
  return (
    <div
      className={cn("mb-1 font-medium text-foreground text-sm", className)}
      {...props}
    />
  );
}

export type ConfirmationRequestProps = ComponentProps<"div">;

export function ConfirmationRequest(props: ConfirmationRequestProps) {
  const { state } = useConfirmation();

  if (state !== "approval-requested") {
    return null;
  }

  return <ConfirmationBody {...props} />;
}

export type ConfirmationAcceptedProps = ComponentProps<"div">;

export function ConfirmationAccepted(props: ConfirmationAcceptedProps) {
  const { approval, state } = useConfirmation();

  if (
    approval.approved !== true ||
    (state !== "approval-responded" && state !== "output-available")
  ) {
    return null;
  }

  return <ConfirmationBody {...props} />;
}

export type ConfirmationRejectedProps = ComponentProps<"div">;

export function ConfirmationRejected(props: ConfirmationRejectedProps) {
  const { approval, state } = useConfirmation();

  if (approval.approved !== false || state !== "output-denied") {
    return null;
  }

  return <ConfirmationBody {...props} />;
}

export type ConfirmationActionsProps = ComponentProps<"div">;

export function ConfirmationActions({
  className,
  ...props
}: ConfirmationActionsProps) {
  const { state } = useConfirmation();

  if (state !== "approval-requested") {
    return null;
  }

  return (
    <div
      className={cn("mt-3 flex justify-end gap-2", className)}
      {...props}
    />
  );
}

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export function ConfirmationAction({
  className,
  size = "sm",
  ...props
}: ConfirmationActionProps) {
  return <Button className={cn("text-sm", className)} size={size} {...props} />;
}

function ConfirmationBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 text-muted-foreground text-sm",
        className,
      )}
      {...props}
    />
  );
}

function useConfirmation() {
  const context = useContext(ConfirmationContext);

  if (!context) {
    throw new Error("Confirmation components must be used inside Confirmation.");
  }

  return context;
}
