import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { UsersSection } from './users-section';
import type { User } from '../../lib/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const users: User[] = [
  {
    id: 'user-1',
    displayName: 'Старое имя',
    email: 'user@example.com',
    role: 'MEMBER',
    createdAt: '2026-04-07T10:00:00.000Z',
    telegramAccounts: [{ telegramId: '1', username: 'user', isActive: true }],
  },
];

describe('UsersSection', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    }
  });

  it('enters edit mode and submits inline rename', async () => {
    const onRenameUser = jest.fn().mockResolvedValue(true);

    await act(async () => {
      renderer = create(<UsersSection users={users} onRenameUser={onRenameUser} />);
    });

    const renameButton = renderer!.root.findAllByType('button').find((button) => button.props.children === 'Переименовать');
    expect(renameButton).toBeDefined();

    await act(async () => {
      renameButton!.props.onClick();
    });

    const input = renderer!.root.findAllByType('input').find((node) => node.props.value === 'Старое имя');
    await act(async () => {
      input.props.onChange({ target: { value: 'Новое имя' } });
    });

    const saveButton = renderer!.root.findAllByType('button').find((button) => button.props.children === 'Сохранить имя');
    await act(async () => {
      await saveButton!.props.onClick();
    });

    expect(onRenameUser).toHaveBeenCalledWith('user-1', 'Новое имя');
  });

  it('cancels inline rename and restores default actions', async () => {
    await act(async () => {
      renderer = create(<UsersSection users={users} onRenameUser={jest.fn().mockResolvedValue(true)} />);
    });

    const renameButton = renderer!.root.findAllByType('button').find((button) => button.props.children === 'Переименовать');
    await act(async () => {
      renameButton!.props.onClick();
    });

    const cancelButton = renderer!.root.findAllByType('button').find((button) => button.props.children === 'Отмена');
    await act(async () => {
      cancelButton!.props.onClick();
    });

    expect(renderer!.root.findAllByType('button').some((button) => button.props.children === 'Переименовать')).toBe(true);
  });
});
