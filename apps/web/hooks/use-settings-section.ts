'use client';

import { useCallback, useState } from 'react';
import { emptyPasswordForm } from '../lib/types';

export function useSettingsSection() {
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [backupState, setBackupState] = useState({
    message: null as string | null,
    error: null as string | null,
    creating: false,
    downloading: false,
  });
  const [passwordState, setPasswordState] = useState({
    form: emptyPasswordForm,
    error: null as string | null,
    success: null as string | null,
  });

  const reset = useCallback(() => {
    setSettingsMessage(null);
    setBackupState({
      message: null,
      error: null,
      creating: false,
      downloading: false,
    });
    setPasswordState({
      form: emptyPasswordForm,
      error: null,
      success: null,
    });
  }, []);

  return {
    settingsMessage,
    setSettingsMessage,
    backupState,
    setBackupState,
    passwordState,
    setPasswordState,
    reset,
  };
}
