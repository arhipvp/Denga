import { UnauthorizedError } from './api';
import type { DashboardFeatureApi } from './dashboard-api';
import type {
  AuthState,
  BackupInfo,
  OperationFormState,
  PasswordFormState,
  Settings,
} from './types';

type HandleUnauthorized = (candidate: unknown, fallbackMessage: string) => boolean;

export async function saveSettingsAction(input: {
  auth: AuthState | null;
  settings: Settings | null;
  formData: FormData;
  featureApi: DashboardFeatureApi;
  onUnauthorized: HandleUnauthorized;
  setSettings: (settings: Settings) => void;
  setSettingsMessage: (message: string | null) => void;
}) {
  if (!input.auth || !input.settings) {
    return false;
  }

  input.setSettingsMessage(null);

  try {
    const nextSettings = await input.featureApi.settings.save(input.auth.accessToken, {
      householdName: input.formData.get('householdName'),
      defaultCurrency: input.formData.get('defaultCurrency'),
      telegramMode: input.formData.get('telegramMode'),
      aiModel: input.formData.get('aiModel'),
      clarificationTimeoutMinutes: Number(
        input.formData.get('clarificationTimeoutMinutes'),
      ),
      parsingPrompt: input.formData.get('parsingPrompt'),
      clarificationPrompt: input.formData.get('clarificationPrompt'),
    });
    input.setSettings(nextSettings);
    input.setSettingsMessage('Настройки сохранены');
    return true;
  } catch (error) {
    input.onUnauthorized(error, 'Не удалось сохранить настройки');
    return false;
  }
}

export async function createBackupAction(input: {
  auth: AuthState | null;
  featureApi: DashboardFeatureApi;
  onUnauthorized: HandleUnauthorized;
  setLatestBackup: (backup: BackupInfo) => void;
  setBackupTaskState: (state: {
    status: 'idle' | 'loading' | 'success' | 'error';
    error: string | null;
    message: string | null;
    currentAction: 'create' | 'download' | null;
  }) => void;
}) {
  if (!input.auth) {
    return false;
  }

  input.setBackupTaskState({
    status: 'loading',
    error: null,
    message: null,
    currentAction: 'create',
  });

  try {
    const backup = await input.featureApi.settings.createBackup(input.auth.accessToken);
    input.setLatestBackup(backup);
    input.setBackupTaskState({
      status: 'success',
      error: null,
      message: `Бэкап ${backup.fileName} создан`,
      currentAction: 'create',
    });
    return true;
  } catch (error) {
    if (!input.onUnauthorized(error, 'Не удалось создать бэкап')) {
      input.setBackupTaskState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Не удалось создать бэкап',
        message: null,
        currentAction: 'create',
      });
    }
    return false;
  }
}

export async function downloadLatestBackupAction(input: {
  auth: AuthState | null;
  featureApi: DashboardFeatureApi;
  latestBackup: BackupInfo | null;
  onUnauthorized: HandleUnauthorized;
  onDownload: (payload: { blob: Blob; fileName: string | null }) => string;
  setBackupTaskState: (state: {
    status: 'idle' | 'loading' | 'success' | 'error';
    error: string | null;
    message: string | null;
    currentAction: 'create' | 'download' | null;
  }) => void;
}) {
  if (!input.auth) {
    return false;
  }

  input.setBackupTaskState({
    status: 'loading',
    error: null,
    message: null,
    currentAction: 'download',
  });

  try {
    const payload = await input.featureApi.settings.downloadLatestBackup(input.auth.accessToken);
    const downloadedFileName = input.onDownload(payload) ?? input.latestBackup?.fileName ?? 'denga-backup.dump';
    input.setBackupTaskState({
      status: 'success',
      error: null,
      message: `Бэкап ${downloadedFileName} скачан`,
      currentAction: 'download',
    });
    return true;
  } catch (error) {
    if (!input.onUnauthorized(error, 'Не удалось скачать бэкап')) {
      input.setBackupTaskState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Не удалось скачать бэкап',
        message: null,
        currentAction: 'download',
      });
    }
    return false;
  }
}

export async function changePasswordAction(input: {
  auth: AuthState | null;
  featureApi: DashboardFeatureApi;
  passwordForm: PasswordFormState;
  clearSession: (message?: string) => void;
  setPasswordState: (state: {
    form: PasswordFormState;
    error: string | null;
    success: string | null;
  }) => void;
}) {
  if (!input.auth) {
    return false;
  }

  input.setPasswordState({
    form: input.passwordForm,
    error: null,
    success: null,
  });

  if (input.passwordForm.newPassword !== input.passwordForm.confirmPassword) {
    input.setPasswordState({
      form: input.passwordForm,
      error: 'Новый пароль и подтверждение не совпадают',
      success: null,
    });
    return false;
  }

  try {
    await input.featureApi.settings.changePassword(input.auth.accessToken, {
      currentPassword: input.passwordForm.currentPassword,
      newPassword: input.passwordForm.newPassword,
    });
    input.setPasswordState({
      form: {
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      },
      error: null,
      success: 'Пароль обновлен',
    });
    return true;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      input.clearSession(error.message);
      return false;
    }

    input.setPasswordState({
      form: input.passwordForm,
      error: error instanceof Error ? error.message : 'Не удалось обновить пароль',
      success: null,
    });
    return false;
  }
}

export async function saveOperationAction(input: {
  auth: AuthState | null;
  featureApi: DashboardFeatureApi;
  operationForm: OperationFormState;
  onUnauthorized: HandleUnauthorized;
  onSaved: () => Promise<void>;
  onReset: () => void;
}) {
  if (!input.auth) {
    return false;
  }

  try {
    await input.featureApi.operations.save(input.auth.accessToken, {
      id: input.operationForm.id,
      type: input.operationForm.type,
      amount: Number(input.operationForm.amount),
      occurredAt: new Date(input.operationForm.occurredAt).toISOString(),
      categoryId: input.operationForm.categoryId,
      comment: input.operationForm.comment,
      status: input.operationForm.status,
    });
  } catch (error) {
    input.onUnauthorized(error, 'Не удалось сохранить операцию');
    return false;
  }

  input.onReset();
  await input.onSaved();
  return true;
}

export async function runDashboardMutation(input: {
  auth: AuthState | null;
  execute: (token: string) => Promise<unknown>;
  onUnauthorized: HandleUnauthorized;
  fallbackMessage: string;
  onSuccess?: () => Promise<void>;
}) {
  if (!input.auth) {
    return false;
  }

  try {
    await input.execute(input.auth.accessToken);
  } catch (error) {
    input.onUnauthorized(error, input.fallbackMessage);
    return false;
  }

  if (input.onSuccess) {
    await input.onSuccess();
  }
  return true;
}
