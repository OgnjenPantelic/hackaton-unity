import React, { useState } from "react";
import { useAssistantContext } from "../../context/AssistantContext";

interface AssistantSettingsModalProps {
  onClose: () => void;
}

export const AssistantSettingsModal: React.FC<AssistantSettingsModalProps> = ({ onClose }) => {
  const { selectedModel, availableModels, modelsLoading, updateModel, provider, deleteProviderKey, deleteAllKeys } = useAssistantContext();
  const [localSelection, setLocalSelection] = useState(selectedModel || "openai/gpt-4o-mini");
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<'provider' | 'all' | null>(null);

  const handleSave = async () => {
    setSaving(true);
    await updateModel(localSelection);
    setSaving(false);
    onClose();
  };

  const handleDeleteProvider = async () => {
    if (provider) {
      await deleteProviderKey(provider);
      onClose();
    }
  };

  const handleDeleteAll = async () => {
    await deleteAllKeys();
    onClose();
  };

  const getProviderName = () => {
    switch (provider) {
      case 'github-models': return 'GitHub';
      case 'openai': return 'OpenAI';
      case 'claude': return 'Claude';
      default: return provider;
    }
  };

  return (
    <div className="assistant-settings-modal" onClick={onClose}>
      <div className="assistant-settings-content" onClick={(e) => e.stopPropagation()}>
        <div className="assistant-settings-header">
          <h3>Model Settings</h3>
          <button className="assistant-settings-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="assistant-settings-body">
          <p className="assistant-settings-description">
            Choose which AI model to use for your conversations:
          </p>

          {modelsLoading ? (
            <div className="assistant-settings-loading">
              <span className="spinner" style={{ width: 24, height: 24 }} />
              <span>Loading available models...</span>
            </div>
          ) : availableModels.length === 0 ? (
            <div className="assistant-settings-loading">
              <span>No models available</span>
            </div>
          ) : (
            <div className="assistant-model-options">
              {availableModels.map((model) => (
                <label key={model.id} className="assistant-model-option">
                  <input
                    type="radio"
                    name="model"
                    value={model.id}
                    checked={localSelection === model.id}
                    onChange={(e) => setLocalSelection(e.target.value)}
                  />
                  <span className="assistant-model-label">
                    <span className="assistant-model-name">{model.name}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {showDeleteConfirm ? (
          <div className="assistant-settings-footer">
            <p>
              {showDeleteConfirm === 'provider' 
                ? `Delete your ${getProviderName()} API key?`
                : 'Delete all API keys?'}
            </p>
            <button className="btn btn-link" onClick={() => setShowDeleteConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={showDeleteConfirm === 'provider' ? handleDeleteProvider : handleDeleteAll}
            >
              Delete
            </button>
          </div>
        ) : (
          <>
            <div className="assistant-settings-footer">
              <button className="btn btn-link" onClick={onClose} disabled={saving || modelsLoading}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || modelsLoading || localSelection === selectedModel}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
            
            <div className="assistant-settings-delete">
              <button
                className="btn btn-link-danger"
                onClick={() => setShowDeleteConfirm('provider')}
              >
                Delete {getProviderName()} Key
              </button>
              <button
                className="btn btn-link-danger"
                onClick={() => setShowDeleteConfirm('all')}
              >
                Delete All Keys
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
