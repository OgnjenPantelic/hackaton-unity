import { ReactNode } from "react";
import { LoadingSpinner } from "./LoadingSpinner";

type AlertType = "success" | "error" | "warning" | "info" | "loading";

interface AlertProps {
  type: AlertType;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Alert({ type, children, className = "", style }: AlertProps) {
  const typeClass = type === "loading" ? "alert-loading" : `alert-${type}`;
  const role = type === "error" ? "alert" : type === "loading" ? "status" : undefined;
  const ariaLive = type === "loading" ? ("polite" as const) : undefined;
  return (
    <div
      className={`alert ${typeClass} ${className}`.trim()}
      role={role}
      aria-live={ariaLive}
      style={style}
    >
      {type === "loading" && <LoadingSpinner size="small" />}
      {children}
    </div>
  );
}

interface StatusMessageProps {
  type: "success" | "error" | "loading";
  message: string;
}

export function StatusMessage({ type, message }: StatusMessageProps) {
  if (type === "loading") {
    return (
      <div className="flex-row gap-8" role="status" aria-live="polite" style={{ alignItems: "center" }}>
        <LoadingSpinner size="small" />
        <span className="loading">{message}</span>
      </div>
    );
  }

  return (
    <span className={type} role={type === "error" ? "alert" : undefined}>
      {message}
    </span>
  );
}
