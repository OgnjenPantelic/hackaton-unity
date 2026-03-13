import { renderHook } from "@testing-library/react";
import { useWizard } from "../../hooks/useWizard";

describe("useWizard", () => {
  it("throws when used outside WizardProvider", () => {
    expect(() => {
      renderHook(() => useWizard());
    }).toThrow("useWizard must be used within WizardProvider");
  });
});
