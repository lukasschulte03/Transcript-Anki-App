import { useCallback, useEffect, useState } from "react";
import { readCredential } from "../services/credentials";

/**
 * Reads a provider key from the operating system credential store. Keys are
 * entered and changed in Settings; feature views only consume the saved key.
 */
export function useStoredCredential(credentialKey: string, enabled = true) {
  const [credential, setCredential] = useState("");
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCredential("");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setCredential((await readCredential(credentialKey)) ?? "");
    } catch {
      // A missing key is a normal setup state, not an application error.
      setCredential("");
    } finally {
      setLoading(false);
    }
  }, [credentialKey, enabled]);

  useEffect(() => {
    // Defer the credential-store read beyond the effect itself. This is an
    // external asynchronous synchronization, not a derived render update.
    void Promise.resolve().then(refresh);
  }, [refresh]);

  return {
    credential,
    configured: Boolean(credential),
    loading,
    refresh,
  };
}
