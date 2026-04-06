'use client';

import { useCallback, useState } from 'react';
import { createAsyncTaskState } from '../lib/async-state';
import { emptyPasswordForm } from '../lib/types';

export function useSettingsSection() {
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [backupTaskState, setBackupTaskState] = useState(() => ({
    ...createAsyncTaskState(),
    currentAction: null as 'create' | 'download' | null,
  }));
  const [passwordState, setPasswordState] = useState({
    form: emptyPasswordForm,
    error: null as string | null,
    success: null as string | null,
  });

  const reset = useCallback(() => {
    setSettingsMessage(null);
    setBackupTaskState({
      ...createAsyncTaskState(),
      currentAction: null,
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
    backupTaskState,
    setBackupTaskState,
    passwordState,
    setPasswordState,
    reset,
  };
}
