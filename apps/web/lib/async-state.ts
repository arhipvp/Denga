export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export type AsyncState = {
  status: AsyncStatus;
  error: string | null;
};

export type AsyncTaskState = AsyncState & {
  message: string | null;
};

export function createAsyncState(): AsyncState {
  return {
    status: 'idle',
    error: null,
  };
}

export function createAsyncTaskState(): AsyncTaskState {
  return {
    status: 'idle',
    error: null,
    message: null,
  };
}
