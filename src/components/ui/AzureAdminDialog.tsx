interface AzureAdminDialogProps {
  userEmail: string;
  onYes: () => void;
  onNo: () => void;
}

export function AzureAdminDialog({ userEmail, onYes, onNo }: AzureAdminDialogProps) {
  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <h3>Use Azure Identity for Databricks?</h3>
        <p>
          Is your Azure account <strong>{userEmail}</strong> a Databricks Account Admin?
        </p>
        <p className="help-text">
          If yes, you can use your Azure identity directly instead of creating a separate service principal.
        </p>
        <div className="dialog-buttons">
          <button onClick={onNo} className="secondary">
            No, use separate credentials
          </button>
          <button onClick={onYes} className="primary">
            Yes, use my Azure identity
          </button>
        </div>
      </div>
    </div>
  );
}
