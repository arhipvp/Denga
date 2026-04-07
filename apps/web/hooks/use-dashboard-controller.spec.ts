import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useDashboardController } from './use-dashboard-controller';
import type { LogListFilters, TransactionListFilters } from '../lib/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockReloadData = jest.fn<Promise<void>, [string, TransactionListFilters]>(async () => undefined);
const mockReloadLogs = jest.fn<Promise<void>, [string, LogListFilters]>(async () => undefined);
const mockSaveAuth = jest.fn();
const mockClearAuth = jest.fn();
const mockSetSettings = jest.fn();
const mockSetLatestBackup = jest.fn();
const mockSetError = jest.fn();
const mockSetLogsError = jest.fn();
const mockResetData = jest.fn();

type ControllerSnapshot = ReturnType<typeof useDashboardController> | null;

let latestController: ControllerSnapshot = null;
const mockAuth = {
  accessToken: 'token',
  refreshToken: 'refresh-token',
  expiresAt: '2026-04-07T00:00:00.000Z',
  user: {
    id: 'user-1',
    email: 'user@example.com',
    role: 'ADMIN' as const,
  },
};
const mockFeatureApi = {
  auth: { login: jest.fn() },
  operations: { save: jest.fn(), cancel: jest.fn() },
  categories: { save: jest.fn(), deactivate: jest.fn(), restore: jest.fn() },
  settings: {
    save: jest.fn(),
    createBackup: jest.fn(),
    downloadLatestBackup: jest.fn(),
    changePassword: jest.fn(),
  },
};

jest.mock('./use-auth-session', () => ({
  useAuthSession: () => ({
    auth: mockAuth,
    saveAuth: mockSaveAuth,
    clearAuth: mockClearAuth,
  }),
}));

jest.mock('./use-dashboard-data', () => ({
  useDashboardData: () => ({
    featureApi: mockFeatureApi,
    categories: [],
    logs: { items: [], total: 0, page: 1, pageSize: 10 },
    settings: null,
    latestBackup: null,
    setSettings: mockSetSettings,
    setLatestBackup: mockSetLatestBackup,
    setError: mockSetError,
    setLogsError: mockSetLogsError,
    resetData: mockResetData,
    reloadData: mockReloadData,
    reloadLogs: mockReloadLogs,
  }),
}));

jest.mock('./use-operations-section', () => {
  return {
    useOperationsSection: () => {
      const [filters, setFiltersState] = React.useState<TransactionListFilters>({
        status: 'confirmed',
        type: 'all',
        search: '',
        sortBy: 'occurredAt',
        sortDir: 'desc',
        page: 1,
        pageSize: 10,
      });
      const [isOperationModalOpen, setOperationModalOpen] = React.useState(false);
      const [operationForm, setOperationFormState] = React.useState({
        id: '',
        type: 'expense' as const,
        amount: '',
        occurredAt: '',
        categoryId: '',
        comment: '',
        status: 'confirmed' as const,
      });

      const setOperationForm = React.useCallback(
        (
          updater:
            | typeof operationForm
            | ((current: typeof operationForm) => typeof operationForm),
        ) => {
          setOperationFormState((current) =>
            typeof updater === 'function' ? updater(current) : updater,
          );
        },
        [],
      );

      const reset = React.useCallback(() => {
        setOperationModalOpen(false);
        setOperationFormState({
          id: '',
          type: 'expense',
          amount: '',
          occurredAt: '',
          categoryId: '',
          comment: '',
          status: 'confirmed',
        });
      }, []);

      return {
        filters,
        setFilters: (
          updater:
            | TransactionListFilters
            | ((current: TransactionListFilters) => TransactionListFilters),
        ) => {
          setFiltersState((current) =>
            typeof updater === 'function' ? updater(current) : updater,
          );
        },
        isOperationModalOpen,
        setOperationModalOpen,
        operationForm,
        setOperationForm,
        filteredCategories: [],
        openCreateOperationModal: jest.fn(),
        openEditOperationModal: jest.fn(),
        reset,
      };
    },
  };
});

jest.mock('./use-categories-section', () => {
  return {
    useCategoriesSection: () => {
      const [isCategoryModalOpen, setCategoryModalOpen] = React.useState(false);
      const [categoryForm, setCategoryFormState] = React.useState({
        id: '',
        name: '',
        type: 'expense' as const,
        isActive: true,
      });

      const setCategoryForm = React.useCallback(
        (
          updater:
            | typeof categoryForm
            | ((current: typeof categoryForm) => typeof categoryForm),
        ) => {
          setCategoryFormState((current) =>
            typeof updater === 'function' ? updater(current) : updater,
          );
        },
        [],
      );

      const reset = React.useCallback(() => {
        setCategoryModalOpen(false);
        setCategoryFormState({
          id: '',
          name: '',
          type: 'expense',
          isActive: true,
        });
      }, []);

      return {
        categoryStatusFilter: 'active' as const,
        setCategoryStatusFilter: jest.fn(),
        categoryTypeFilter: 'all' as const,
        setCategoryTypeFilter: jest.fn(),
        isCategoryModalOpen,
        setCategoryModalOpen,
        categoryForm,
        setCategoryForm,
        visibleCategories: [],
        openCreateCategoryModal: jest.fn(),
        openEditCategoryModal: jest.fn(),
        reset,
      };
    },
  };
});

jest.mock('./use-settings-section', () => {
  return {
    useSettingsSection: () => {
      const [settingsMessage, setSettingsMessage] = React.useState<string | null>(null);
      const [backupTaskState, setBackupTaskState] = React.useState({
        status: 'idle' as const,
        error: null as string | null,
        message: null as string | null,
        currentAction: null as 'create' | 'download' | null,
      });
      const [passwordState, setPasswordState] = React.useState({
        form: {
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        },
        error: null as string | null,
        success: null as string | null,
      });

      const reset = React.useCallback(() => {
        setSettingsMessage(null);
        setBackupTaskState({
          status: 'idle',
          error: null,
          message: null,
          currentAction: null,
        });
        setPasswordState({
          form: {
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
          },
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
    },
  };
});

jest.mock('./use-logs-section', () => {
  return {
    useLogsSection: () => {
      const [filters, setFiltersState] = React.useState<LogListFilters>({
        level: 'all',
        source: 'all',
        search: '',
        sortBy: 'timestamp',
        sortDir: 'desc',
        page: 1,
        pageSize: 10,
      });

      return {
        filters,
        setFilters: (
          updater: LogListFilters | ((current: LogListFilters) => LogListFilters),
        ) => {
          setFiltersState((current) =>
            typeof updater === 'function' ? updater(current) : updater,
          );
        },
        logSources: [],
      };
    },
  };
});

function TestHarness({ apiUrl }: { apiUrl: string | null }) {
  const controller = useDashboardController(apiUrl);

  React.useEffect(() => {
    latestController = controller;
  }, [controller]);

  return null;
}

describe('useDashboardController', () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    latestController = null;
    mockReloadData.mockClear();
    mockReloadLogs.mockClear();
    mockSaveAuth.mockClear();
    mockClearAuth.mockClear();
    mockSetSettings.mockClear();
    mockSetLatestBackup.mockClear();
    mockSetError.mockClear();
    mockSetLogsError.mockClear();
    mockResetData.mockClear();
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    }
  });

  it('does not reload dashboard data on a stable rerender', async () => {
    await act(async () => {
      renderer = create(React.createElement(TestHarness, { apiUrl: 'http://localhost:3000' }));
    });

    expect(mockReloadData).toHaveBeenCalled();
    expect(mockReloadData).toHaveBeenLastCalledWith('token', {
      status: 'confirmed',
      type: 'all',
      search: '',
      sortBy: 'occurredAt',
      sortDir: 'desc',
      page: 1,
      pageSize: 10,
    });
    const initialCalls = mockReloadData.mock.calls.length;

    await act(async () => {
      renderer?.update(React.createElement(TestHarness, { apiUrl: 'http://localhost:3000' }));
    });

    expect(mockReloadData).toHaveBeenCalledTimes(initialCalls);
  });

  it('does not reload logs on a stable rerender while logs section is open', async () => {
    await act(async () => {
      renderer = create(React.createElement(TestHarness, { apiUrl: 'http://localhost:3000' }));
    });

    await act(async () => {
      latestController?.setSection('logs');
    });

    expect(mockReloadLogs).toHaveBeenCalled();
    expect(mockReloadLogs).toHaveBeenLastCalledWith('token', {
      level: 'all',
      source: 'all',
      search: '',
      sortBy: 'timestamp',
      sortDir: 'desc',
      page: 1,
      pageSize: 10,
    });
    const initialCalls = mockReloadLogs.mock.calls.length;

    await act(async () => {
      renderer?.update(React.createElement(TestHarness, { apiUrl: 'http://localhost:3000' }));
    });

    expect(mockReloadLogs).toHaveBeenCalledTimes(initialCalls);
  });

  it('reloads exactly once when dashboard and log filters change', async () => {
    await act(async () => {
      renderer = create(React.createElement(TestHarness, { apiUrl: 'http://localhost:3000' }));
    });

    mockReloadData.mockClear();

    await act(async () => {
      latestController?.operations.setFilters((current) => ({ ...current, status: 'all' }));
    });

    expect(mockReloadData).toHaveBeenCalledTimes(1);
    expect(mockReloadData).toHaveBeenLastCalledWith('token', {
      status: 'all',
      type: 'all',
      search: '',
      sortBy: 'occurredAt',
      sortDir: 'desc',
      page: 1,
      pageSize: 10,
    });

    await act(async () => {
      latestController?.setSection('logs');
    });

    mockReloadLogs.mockClear();

    await act(async () => {
      latestController?.logsSection.setFilters((current) => ({ ...current, level: 'error' }));
    });

    expect(mockReloadLogs).toHaveBeenCalledTimes(1);
    expect(mockReloadLogs).toHaveBeenLastCalledWith('token', {
      level: 'error',
      source: 'all',
      search: '',
      sortBy: 'timestamp',
      sortDir: 'desc',
      page: 1,
      pageSize: 10,
    });
  });
});
