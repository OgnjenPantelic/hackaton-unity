interface AuthModeSelectorProps<T extends string> {
  value: T;
  onChange: (mode: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  /** Accessible label for the radio group. */
  groupLabel?: string;
  /** Unique name for the radio group (prevents cross-component conflicts). */
  name?: string;
}

export function AuthModeSelector<T extends string>({
  value,
  onChange,
  options,
  disabled = false,
  groupLabel = "Authentication mode",
  name = "auth-mode",
}: AuthModeSelectorProps<T>) {
  return (
    <div className="auth-mode-selector" role="radiogroup" aria-label={groupLabel}>
      {options.map((option) => (
        <label key={option.value} className="radio-label">
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
