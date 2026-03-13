interface LoadingSpinnerProps {
  size?: "small" | "medium" | "large";
  className?: string;
}

export function LoadingSpinner({ size = "medium", className = "" }: LoadingSpinnerProps) {
  const sizeClass = size === "large" ? "large" : "";
  return <span className={`spinner ${sizeClass} ${className}`.trim()} />;
}

interface LoadingOverlayProps {
  message?: string;
}

export function LoadingOverlay({ message = "Loading..." }: LoadingOverlayProps) {
  return (
    <div className="loading-overlay">
      <div className="loading-content">
        <LoadingSpinner size="large" />
        <span>{message}</span>
      </div>
    </div>
  );
}
