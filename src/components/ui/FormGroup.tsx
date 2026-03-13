import { ReactNode, useId } from "react";

interface FormGroupProps {
  label: string;
  helpText?: string;
  required?: boolean;
  error?: boolean;
  children: ReactNode;
  /** Optional explicit id for the input element (links the label via htmlFor). */
  inputId?: string;
}

export function FormGroup({
  label,
  helpText,
  required = false,
  error = false,
  children,
  inputId,
}: FormGroupProps) {
  const autoId = useId();
  const helpId = helpText ? `${autoId}-help` : undefined;
  const errorId = error ? `${autoId}-error` : undefined;

  return (
    <div className="form-group">
      <label htmlFor={inputId}>
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      {children}
      {helpText && <div id={helpId} className="help-text">{helpText}</div>}
      {error && (
        <div id={errorId} className="text-error text-xs mt-4" role="alert">
          This field is required
        </div>
      )}
    </div>
  );
}

interface FormSectionProps {
  title: string;
  cloud?: string;
  advanced?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

export function FormSection({
  title,
  cloud,
  advanced = false,
  expanded = true,
  onToggle,
  children,
}: FormSectionProps) {
  const classes = [
    "form-section",
    cloud,
    advanced ? "advanced" : "",
    advanced && expanded ? "expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (advanced && onToggle) {
    return (
      <div className={classes}>
        <h3
          onClick={onToggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
        >
          <span aria-hidden="true">{expanded ? "▼" : "▶"}</span>
          {title}
        </h3>
        {expanded && children}
      </div>
    );
  }

  return (
    <div className={classes}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
