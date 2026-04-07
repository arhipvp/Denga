'use client';

import { useCallback, useMemo, useState } from 'react';
import { createAsyncTaskState } from '../lib/async-state';
import { emptyPasswordForm, type Settings, type SettingsFormState } from '../lib/types';

function areSettingsEqual(left: SettingsFormState | null, right: Settings | null) {
  if (!left || !right) {
    return false;
  }

  return (
    left.householdName === right.householdName &&
    left.defaultCurrency === right.defaultCurrency &&
    left.telegramMode === right.telegramMode &&
    left.aiModel === right.aiModel &&
    left.clarificationTimeoutMinutes === right.clarificationTimeoutMinutes &&
    left.parsingPrompt === right.parsingPrompt &&
    left.clarificationPrompt === right.clarificationPrompt
  );
}

export function useSettingsSection(settings: Settings | null) {
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
  const [settingsForm, setSettingsForm] = useState<SettingsFormState | null>(null);
  const [aiExpanded, setAiExpanded] = useState(false);

  const hasUnsavedChanges = useMemo(
    () => Boolean(settingsForm && settings && !areSettingsEqual(settingsForm, settings)),
    [settings, settingsForm],
  );

  const resetSettingsForm = useCallback(() => {
    setSettingsForm(null);
    setSettingsMessage(null);
  }, []);

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
    setSettingsForm(null);
    setAiExpanded(false);
  }, []);

  return {
    settingsMessage,
    setSettingsMessage,
    backupTaskState,
    setBackupTaskState,
    passwordState,
    setPasswordState,
    settingsForm,
    setSettingsForm,
    hasUnsavedChanges,
    resetSettingsForm,
    aiExpanded,
    setAiExpanded,
    reset,
  };
}
