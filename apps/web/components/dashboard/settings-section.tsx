'use client';

import { format } from 'date-fns';
import type { FormEvent } from 'react';
import type { BackupInfo, PasswordFormState, Settings, SettingsFormState } from '../../lib/types';

function formatBackupSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

type SettingsSectionProps = {
  settings: Settings;
  settingsForm: SettingsFormState | null;
  hasUnsavedChanges: boolean;
  aiExpanded: boolean;
  latestBackup: BackupInfo | null;
  backupMessage: string | null;
  backupError: string | null;
  backupCreating: boolean;
  backupDownloading: boolean;
  settingsMessage: string | null;
  passwordForm: PasswordFormState;
  passwordError: string | null;
  passwordSuccess: string | null;
  onCreateBackup: () => Promise<void>;
  onDownloadLatestBackup: () => Promise<void>;
  onSaveSettings: () => Promise<void>;
  onResetSettings: () => void;
  onChangePassword: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSettingsFormChange: (
    updater: (current: SettingsFormState) => SettingsFormState,
  ) => void;
  onToggleAiExpanded: () => void;
  onPasswordFormChange: (
    updater: (current: PasswordFormState) => PasswordFormState,
  ) => void;
};

export function SettingsSection({
  settings,
  settingsForm,
  hasUnsavedChanges,
  aiExpanded,
  latestBackup,
  backupMessage,
  backupError,
  backupCreating,
  backupDownloading,
  settingsMessage,
  passwordForm,
  passwordError,
  passwordSuccess,
  onCreateBackup,
  onDownloadLatestBackup,
  onSaveSettings,
  onResetSettings,
  onChangePassword,
  onSettingsFormChange,
  onToggleAiExpanded,
  onPasswordFormChange,
}: SettingsSectionProps) {
  if (!settingsForm) {
    return null;
  }

  return (
    <section className="settings-page">
      <div className="section-intro">
        <h3>Настройки</h3>
        <p>Управляйте базовой конфигурацией семьи, продвинутыми AI-параметрами и административными действиями.</p>
      </div>

      <article className="panel card settings-card">
        <div className="settings-card__header">
          <div className="section-intro">
            <h3>Основное</h3>
            <p>Текущая операционная конфигурация семьи и Telegram-канала.</p>
          </div>
          <div className="settings-card__status">
            <span className={`badge ${hasUnsavedChanges ? 'warn' : 'success'}`}>
              {hasUnsavedChanges ? 'Есть несохраненные изменения' : 'Все изменения сохранены'}
            </span>
          </div>
        </div>

        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSaveSettings();
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="householdName">Название семьи</label>
              <input
                id="householdName"
                value={settingsForm.householdName}
                onChange={(event) =>
                  onSettingsFormChange((current) => ({
                    ...current,
                    householdName: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="field">
              <label htmlFor="defaultCurrency">Базовая валюта</label>
              <input id="defaultCurrency" value={settings.defaultCurrency} readOnly required />
              <small>Все новые операции в системе сохраняются только в евро.</small>
            </div>
            <div className="field">
              <label htmlFor="telegramMode">Режим Telegram</label>
              <select
                id="telegramMode"
                value={settingsForm.telegramMode}
                onChange={(event) =>
                  onSettingsFormChange((current) => ({
                    ...current,
                    telegramMode: event.target.value as Settings['telegramMode'],
                  }))
                }
              >
                <option value="polling">опрос</option>
                <option value="webhook">вебхук</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="clarificationTimeoutMinutes">Таймаут уточнения</label>
              <input
                id="clarificationTimeoutMinutes"
                type="number"
                min={1}
                value={settingsForm.clarificationTimeoutMinutes}
                onChange={(event) =>
                  onSettingsFormChange((current) => ({
                    ...current,
                    clarificationTimeoutMinutes: Number(event.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          <div className="settings-form__footer">
            <div className="settings-form__copy">
              <strong>Черновик настроек</strong>
              <span>
                {hasUnsavedChanges
                  ? 'Изменения пока не применены. Сохраните их или сбросьте к текущему состоянию.'
                  : 'Форма синхронизирована с последней сохраненной конфигурацией.'}
              </span>
            </div>
            <div className="actions">
              <button className="button secondary" type="button" disabled={!hasUnsavedChanges} onClick={onResetSettings}>
                Сбросить
              </button>
              <button className="button" type="submit" disabled={!hasUnsavedChanges}>
                Сохранить настройки
              </button>
            </div>
          </div>

          {settingsMessage ? <p className="settings-inline-message">{settingsMessage}</p> : null}
        </form>
      </article>

      <article className="panel card settings-card">
        <div className="settings-card__header">
          <div className="section-intro">
            <h3>AI-настройки</h3>
            <p>Продвинутые параметры разбора и уточнения сообщений. По умолчанию блок свернут.</p>
          </div>
          <button className="button secondary" type="button" onClick={onToggleAiExpanded}>
            {aiExpanded ? 'Скрыть advanced' : 'Показать advanced'}
          </button>
        </div>

        {aiExpanded ? (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="aiModel">AI-модель</label>
              <input
                id="aiModel"
                value={settingsForm.aiModel}
                onChange={(event) =>
                  onSettingsFormChange((current) => ({
                    ...current,
                    aiModel: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="field field--full">
              <label htmlFor="parsingPrompt">Промпт разбора</label>
              <textarea
                id="parsingPrompt"
                value={settingsForm.parsingPrompt}
                onChange={(event) =>
                  onSettingsFormChange((current) => ({
                    ...current,
                    parsingPrompt: event.target.value,
                  }))
                }
              />
            </div>
            <div className="field field--full">
              <label htmlFor="clarificationPrompt">Промпт уточнения</label>
              <textarea
                id="clarificationPrompt"
                value={settingsForm.clarificationPrompt}
                onChange={(event) =>
                  onSettingsFormChange((current) => ({
                    ...current,
                    clarificationPrompt: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        ) : (
          <p className="empty-copy">Advanced AI-параметры скрыты до явного раскрытия блока.</p>
        )}
      </article>

      <article className="panel card settings-card">
        <div className="section-intro">
          <h3>Бэкапы</h3>
          <p>Локальный backup PostgreSQL только для операций и справочников.</p>
        </div>

        {latestBackup ? (
          <div className="kpi-grid">
            <article className="panel metric-card">
              <span>Последний файл</span>
              <strong>{latestBackup.fileName}</strong>
            </article>
            <article className="panel metric-card">
              <span>Создан</span>
              <strong>{format(new Date(latestBackup.createdAt), 'dd.MM.yyyy HH:mm:ss')}</strong>
            </article>
            <article className="panel metric-card">
              <span>Размер</span>
              <strong>{formatBackupSize(latestBackup.sizeBytes)}</strong>
            </article>
          </div>
        ) : (
          <p className="empty-copy">Бэкапов пока нет.</p>
        )}

        {backupError ? <p className="error">{backupError}</p> : null}
        {backupMessage ? <p className="settings-inline-message">{backupMessage}</p> : null}

        <div className="actions">
          <button className="button" type="button" disabled={backupCreating} onClick={() => void onCreateBackup()}>
            {backupCreating ? 'Создание...' : 'Создать бэкап'}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!latestBackup || backupDownloading}
            onClick={() => void onDownloadLatestBackup()}
          >
            {backupDownloading ? 'Скачивание...' : 'Скачать последний'}
          </button>
        </div>
      </article>

      <article className="panel card settings-card">
        <div className="section-intro">
          <h3>Безопасность</h3>
          <p>Обновление пароля администратора без выхода из текущей сессии, если данные введены корректно.</p>
        </div>
        <form className="form-grid" onSubmit={onChangePassword}>
          <div className="field">
            <label htmlFor="currentPassword">Текущий пароль</label>
            <input
              id="currentPassword"
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) =>
                onPasswordFormChange((current) => ({ ...current, currentPassword: event.target.value }))
              }
              required
            />
          </div>
          <div className="field">
            <label htmlFor="newPassword">Новый пароль</label>
            <input
              id="newPassword"
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) =>
                onPasswordFormChange((current) => ({ ...current, newPassword: event.target.value }))
              }
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Подтверждение нового пароля</label>
            <input
              id="confirmPassword"
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(event) =>
                onPasswordFormChange((current) => ({ ...current, confirmPassword: event.target.value }))
              }
              required
            />
          </div>
          {passwordError ? <p className="error field--full">{passwordError}</p> : null}
          {passwordSuccess ? <p className="settings-inline-message field--full">{passwordSuccess}</p> : null}
          <div className="actions field--full">
            <button className="button" type="submit">
              Обновить пароль
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
