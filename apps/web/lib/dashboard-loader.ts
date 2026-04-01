import type {
  BackupInfo,
  Category,
  LogEntry,
  Settings,
  Summary,
  Transaction,
  User,
} from './types';

type ApiClientLike = {
  request<T>(path: string, token: string, init?: RequestInit): Promise<T>;
};

type DashboardFilters = {
  status: 'all' | 'confirmed' | 'cancelled';
  type: 'all' | 'income' | 'expense';
};

type DashboardDataset = {
  transactions: Transaction[];
  categories: Category[];
  users: User[];
  settings: Settings;
  summary: Summary;
  latestBackup: BackupInfo | null;
};

export class DashboardDataLoadError extends Error {
  constructor(
    readonly resource: string,
    readonly path: string,
    cause?: unknown,
  ) {
    super(`Не удалось загрузить ${resource}`);
    this.name = 'DashboardDataLoadError';
    this.cause = cause;
  }
}

function buildTransactionPath(filters: DashboardFilters) {
  const query = new URLSearchParams();

  if (filters.status !== 'all') {
    query.set('status', filters.status);
  }

  if (filters.type !== 'all') {
    query.set('type', filters.type);
  }

  return `/transactions${query.toString() ? `?${query.toString()}` : ''}`;
}

async function loadRequiredResource<T>(
  apiClient: ApiClientLike,
  token: string,
  resource: string,
  path: string,
) {
  try {
    const payload = await apiClient.request<T | null>(path, token);
    if (payload === null) {
      throw new Error(`API вернул пустой ответ: ${path}`);
    }

    return payload;
  } catch (error) {
    throw new DashboardDataLoadError(resource, path, error);
  }
}

async function loadOptionalResource<T>(
  apiClient: ApiClientLike,
  token: string,
  resource: string,
  path: string,
) {
  try {
    return await apiClient.request<T | null>(path, token);
  } catch (error) {
    throw new DashboardDataLoadError(resource, path, error);
  }
}

export async function loadDashboardDataset(
  apiClient: ApiClientLike,
  token: string,
  filters: DashboardFilters,
): Promise<DashboardDataset> {
  const transactionsPath = buildTransactionPath(filters);

  const [
    transactions,
    categories,
    users,
    settings,
    summary,
    latestBackup,
  ] = await Promise.all([
    loadRequiredResource<Transaction[]>(apiClient, token, 'операции', transactionsPath),
    loadRequiredResource<Category[]>(apiClient, token, 'категории', '/categories'),
    loadRequiredResource<User[]>(apiClient, token, 'пользователи', '/users'),
    loadRequiredResource<Settings>(apiClient, token, 'настройки', '/settings'),
    loadRequiredResource<Summary>(apiClient, token, 'сводку', '/transactions/summary'),
    loadOptionalResource<BackupInfo>(apiClient, token, 'последний бэкап', '/backups/latest'),
  ]);

  return {
    transactions,
    categories,
    users,
    settings,
    summary,
    latestBackup,
  };
}

export async function loadLogsDataset(
  apiClient: ApiClientLike,
  token: string,
  filters: {
    level: 'all' | LogEntry['level'];
    source: string;
  },
) {
  const query = new URLSearchParams();
  query.set('limit', '100');

  if (filters.level !== 'all') {
    query.set('level', filters.level);
  }

  if (filters.source !== 'all') {
    query.set('source', filters.source);
  }

  const path = `/logs?${query.toString()}`;

  try {
    const payload = await apiClient.request<LogEntry[] | null>(path, token);
    if (payload === null) {
      throw new Error(`API вернул пустой ответ: ${path}`);
    }

    return payload;
  } catch (error) {
    throw new DashboardDataLoadError('логи', path, error);
  }
}
