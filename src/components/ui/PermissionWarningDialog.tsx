import { CloudPermissionCheck } from "../../types";

interface PermissionWarningDialogProps {
  cloud: string;
  permissionCheck: CloudPermissionCheck;
  acknowledged: boolean;
  onAcknowledgeChange: (acknowledged: boolean) => void;
  maxDisplay?: number;
}

export function PermissionWarningDialog({
  cloud,
  permissionCheck,
  acknowledged,
  onAcknowledgeChange,
  maxDisplay = 5,
}: PermissionWarningDialogProps) {
  const cloudName = cloud === "aws" ? "AWS" : cloud === "azure" ? "Azure" : "GCP";
  const remaining = permissionCheck.missing_permissions.length - maxDisplay;

  return (
    <div className="alert alert-warning mt-24" role="alert">
      <h3 className="permission-warning-title">Permission Check Warning</h3>
      <p className="mb-12">
        Some required {cloudName} permissions could not be verified:
      </p>
      <ul className="permission-warning-list">
        {permissionCheck.missing_permissions.slice(0, maxDisplay).map((p) => (
          <li key={p}><code>{p}</code></li>
        ))}
        {remaining > 0 && (
          <li className="text-secondary">...and {remaining} more</li>
        )}
      </ul>
      <p className="permission-warning-disclaimer">
        This might be a false positive if you have custom roles, inherited permissions,
        or resource-level restrictions. The deployment may still succeed.
      </p>
      <label className="radio-label permission-warning-acknowledge">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledgeChange(e.target.checked)}
          aria-label="Acknowledge permission warning and continue"
        />
        I understand the risks and want to continue anyway
      </label>
    </div>
  );
}
