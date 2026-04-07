import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SettingsSection } from './settings-section';
import type { SettingsFormState } from '../../lib/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseForm: SettingsFormState = {
  householdName: 'Denga',
  defaultCurrency: 'EUR',
  telegramMode: 'polling',
  aiModel: 'model',
  clarificationTimeoutMinutes: 30,
  parsingPrompt: 'parse',
  clarificationPrompt: 'clarify',
};

describe('SettingsSection', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    }
  });

  it('disables save when there are no unsaved changes and enables reset/save when dirty', async () => {
    await act(async () => {
      renderer = create(
        <SettingsSection
          settings={baseForm}
          settingsForm={baseForm}
          hasUnsavedChanges={false}
          aiExpanded={false}
          latestBackup={null}
          backupMessage={null}
          backupError={null}
          backupCreating={false}
          backupDownloading={false}
          settingsMessage={null}
          passwordForm={{ currentPassword: '', newPassword: '', confirmPassword: '' }}
          passwordError={null}
          passwordSuccess={null}
          onCreateBackup={jest.fn().mockResolvedValue(undefined)}
          onDownloadLatestBackup={jest.fn().mockResolvedValue(undefined)}
          onSaveSettings={jest.fn().mockResolvedValue(undefined)}
          onResetSettings={jest.fn()}
          onChangePassword={jest.fn().mockResolvedValue(undefined)}
          onSettingsFormChange={jest.fn()}
          onToggleAiExpanded={jest.fn()}
          onPasswordFormChange={jest.fn()}
        />,
      );
    });

    const buttons = renderer!.root.findAllByType('button');
    expect(buttons.find((button) => button.props.children === 'Сохранить настройки')?.props.disabled).toBe(true);
    expect(buttons.find((button) => button.props.children === 'Сбросить')?.props.disabled).toBe(true);

    await act(async () => {
      renderer!.update(
        <SettingsSection
          settings={baseForm}
          settingsForm={{ ...baseForm, householdName: 'New Denga' }}
          hasUnsavedChanges={true}
          aiExpanded={false}
          latestBackup={null}
          backupMessage={null}
          backupError={null}
          backupCreating={false}
          backupDownloading={false}
          settingsMessage="Настройки сохранены"
          passwordForm={{ currentPassword: '', newPassword: '', confirmPassword: '' }}
          passwordError={null}
          passwordSuccess={null}
          onCreateBackup={jest.fn().mockResolvedValue(undefined)}
          onDownloadLatestBackup={jest.fn().mockResolvedValue(undefined)}
          onSaveSettings={jest.fn().mockResolvedValue(undefined)}
          onResetSettings={jest.fn()}
          onChangePassword={jest.fn().mockResolvedValue(undefined)}
          onSettingsFormChange={jest.fn()}
          onToggleAiExpanded={jest.fn()}
          onPasswordFormChange={jest.fn()}
        />,
      );
    });

    const dirtyButtons = renderer!.root.findAllByType('button');
    expect(dirtyButtons.find((button) => button.props.children === 'Сохранить настройки')?.props.disabled).toBe(false);
    expect(dirtyButtons.find((button) => button.props.children === 'Сбросить')?.props.disabled).toBe(false);
  });

  it('renders advanced AI fields only when expanded', async () => {
    await act(async () => {
      renderer = create(
        <SettingsSection
          settings={baseForm}
          settingsForm={baseForm}
          hasUnsavedChanges={false}
          aiExpanded={false}
          latestBackup={null}
          backupMessage={null}
          backupError={null}
          backupCreating={false}
          backupDownloading={false}
          settingsMessage={null}
          passwordForm={{ currentPassword: '', newPassword: '', confirmPassword: '' }}
          passwordError={null}
          passwordSuccess={null}
          onCreateBackup={jest.fn().mockResolvedValue(undefined)}
          onDownloadLatestBackup={jest.fn().mockResolvedValue(undefined)}
          onSaveSettings={jest.fn().mockResolvedValue(undefined)}
          onResetSettings={jest.fn()}
          onChangePassword={jest.fn().mockResolvedValue(undefined)}
          onSettingsFormChange={jest.fn()}
          onToggleAiExpanded={jest.fn()}
          onPasswordFormChange={jest.fn()}
        />,
      );
    });

    expect(renderer!.root.findAllByProps({ id: 'aiModel' })).toHaveLength(0);

    await act(async () => {
      renderer!.update(
        <SettingsSection
          settings={baseForm}
          settingsForm={baseForm}
          hasUnsavedChanges={false}
          aiExpanded={true}
          latestBackup={null}
          backupMessage={null}
          backupError={null}
          backupCreating={false}
          backupDownloading={false}
          settingsMessage={null}
          passwordForm={{ currentPassword: '', newPassword: '', confirmPassword: '' }}
          passwordError={null}
          passwordSuccess={null}
          onCreateBackup={jest.fn().mockResolvedValue(undefined)}
          onDownloadLatestBackup={jest.fn().mockResolvedValue(undefined)}
          onSaveSettings={jest.fn().mockResolvedValue(undefined)}
          onResetSettings={jest.fn()}
          onChangePassword={jest.fn().mockResolvedValue(undefined)}
          onSettingsFormChange={jest.fn()}
          onToggleAiExpanded={jest.fn()}
          onPasswordFormChange={jest.fn()}
        />,
      );
    });

    expect(renderer!.root.findAllByProps({ id: 'aiModel' })).toHaveLength(1);
    expect(renderer!.root.findAllByProps({ id: 'parsingPrompt' })).toHaveLength(1);
  });
});
