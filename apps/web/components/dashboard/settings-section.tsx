'use client';

import { format } from 'date-fns';
import type { FormEvent } from 'react';
import type { BackupInfo, PasswordFormState, Settings } from '../../lib/types';

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
  onSaveSettings: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onChangePassword: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onPasswordFormChange: (
    updater: (current: PasswordFormState) => PasswordFormState,
  ) => void;
};

export function SettingsSection({
  settings,
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
  onChangePassword,
  onPasswordFormChange,
}: SettingsSectionProps) {
  return (
    <section className="panel card settings-layout">
      <div className="section-intro">
        <h3>Настройки</h3>
        <p>Конфигурация семьи, Telegram-режима, AI-подсказок и резервного копирования.</p>
      </div>
      <form className="form-grid" onSubmit={onSaveSettings}>
        <div className="field">
          <label htmlFor="householdName">Название семьи</label>
          <input defaultValue={settings.householdName} id="householdName" name="householdName" required />
        </div>
        <div className="field">
          <label htmlFor="defaultCurrency">Базовая валюта</label>
          <input defaultValue="EUR" id="defaultCurrency" maxLength={3} name="defaultCurrency" readOnly required />
          <small>Все новые операции в системе сохраняются только в евро.</small>
        </div>
        <div className="field">
          <label htmlFor="telegramMode">Режим Telegram</label>
          <select defaultValue={settings.telegramMode} id="telegramMode" name="telegramMode">
            <option value="polling">опрос</option>
            <option value="webhook">вебхук</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="aiModel">AI-модель</label>
          <input defaultValue={settings.aiModel} id="aiModel" name="aiModel" required />
        </div>
        <div className="field">
          <label htmlFor="clarificationTimeoutMinutes">Таймаут уточнения</label>
          <input defaultValue={settings.clarificationTimeoutMinutes} id="clarificationTimeoutMinutes" name="clarificationTimeoutMinutes" type="number" />
        </div>
        <div className="field field--full">
          <label htmlFor="parsingPrompt">Промпт разбора</label>
          <textarea defaultValue={settings.parsingPrompt} id="parsingPrompt" name="parsingPrompt" />
        </div>
        <div className="field field--full">
          <label htmlFor="clarificationPrompt">Промпт уточнения</label>
          <textarea defaultValue={settings.clarificationPrompt} id="clarificationPrompt" name="clarificationPrompt" />
        </div>
        <div className="actions field--full">
          <button className="button" type="submit">
            Сохранить настройки
          </button>
        </div>
        {settingsMessage ? <p className="field--full">{settingsMessage}</p> : null}
      </form>

      <div className="settings-subsection">
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
        {backupMessage ? <p>{backupMessage}</p> : null}

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
      </div>

      <div className="settings-subsection">
        <div className="section-intro">
          <h3>Сменить пароль администратора</h3>
          <p>Обновление происходит без выхода из текущей сессии, если данные введены корректно.</p>
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
          {passwordSuccess ? <p className="field--full">{passwordSuccess}</p> : null}
          <div className="actions field--full">
            <button className="button" type="submit">
              Обновить пароль
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
