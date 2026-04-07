import { type UnauthorizedError } from './api';
import {
  DashboardDataLoadError,
  loadDashboardDataset,
  loadLogsDataset,
} from './dashboard-loader';
import type {
  AuthState,
  BackupInfo,
  LogListFilters,
  Settings,
  TransactionListFilters,
  User,
} from './types';

type ApiClientLike = {
  request<T>(path: string, token: string, init?: RequestInit): Promise<T>;
  download(path: string, token: string, init?: RequestInit): Promise<{
    blob: Blob;
    fileName: string | null;
  }>;
  login(email: FormDataEntryValue | null, password: FormDataEntryValue | null): Promise<unknown>;
};

export function createDashboardFeatureApi(apiClient: ApiClientLike) {
  return {
    auth: {
      login(email: FormDataEntryValue | null, password: FormDataEntryValue | null) {
        return apiClient.login(email, password) as Promise<AuthState>;
      },
    },
    dataset: {
      loadMain(token: string, filters: TransactionListFilters) {
        return loadDashboardDataset(apiClient, token, filters);
      },
      loadLogs(token: string, filters: LogListFilters) {
        return loadLogsDataset(apiClient, token, filters);
      },
    },
    operations: {
      save(
        token: string,
        payload: {
          id?: string;
          type: 'income' | 'expense';
          amount: number;
          occurredAt: string;
          categoryId: string;
          comment: string;
          status: 'confirmed' | 'cancelled';
        },
      ) {
        return apiClient.request<unknown>(
          payload.id ? `/transactions/${payload.id}` : '/transactions',
          token,
          {
            method: payload.id ? 'PATCH' : 'POST',
            body: JSON.stringify({
              type: payload.type,
              amount: payload.amount,
              occurredAt: payload.occurredAt,
              categoryId: payload.categoryId,
              comment: payload.comment,
              status: payload.status,
            }),
          },
        );
      },
      cancel(token: string, id: string) {
        return apiClient.request<unknown>(`/transactions/${id}`, token, {
          method: 'DELETE',
        });
      },
    },
    categories: {
      save(
        token: string,
        payload: {
          id?: string;
          name: string;
          type: 'income' | 'expense';
          isActive: boolean;
          parentId?: string | null;
        },
      ) {
        return apiClient.request<unknown>(
          payload.id ? `/categories/${payload.id}` : '/categories',
          token,
          {
            method: payload.id ? 'PATCH' : 'POST',
            body: JSON.stringify(payload),
          },
        );
      },
      deactivate(token: string, id: string) {
        return apiClient.request<unknown>(`/categories/${id}`, token, {
          method: 'DELETE',
        });
      },
      restore(token: string, id: string) {
        return apiClient.request<unknown>(`/categories/${id}`, token, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: true }),
        });
      },
    },
    users: {
      rename(token: string, id: string, payload: { displayName: string }) {
        return apiClient.request<User>(`/users/${id}`, token, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      },
    },
    settings: {
      save(token: string, payload: Record<string, unknown>) {
        return apiClient.request<Settings>('/settings', token, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      },
      createBackup(token: string) {
        return apiClient.request<BackupInfo>('/backups', token, {
          method: 'POST',
        });
      },
      downloadLatestBackup(token: string) {
        return apiClient.download('/backups/latest/download', token);
      },
      changePassword(
        token: string,
        payload: { currentPassword: string; newPassword: string },
      ) {
        return apiClient.request<{ success: true }>('/auth/change-password', token, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      },
    },
  };
}

export type DashboardFeatureApi = ReturnType<typeof createDashboardFeatureApi>;
export { DashboardDataLoadError };
export type { UnauthorizedError };
