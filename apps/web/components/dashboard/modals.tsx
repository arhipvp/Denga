'use client';

import type { FormEvent } from 'react';
import type {
  Category,
  CategoryFormState,
  OperationFormState,
} from '../../lib/types';

type OperationModalProps = {
  isOpen: boolean;
  form: OperationFormState;
  filteredCategories: Category[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onChange: (
    updater: (current: OperationFormState) => OperationFormState,
  ) => void;
};

export function OperationModal({
  isOpen,
  form,
  filteredCategories,
  onClose,
  onSubmit,
  onChange,
}: OperationModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 20, 20, 0.35)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <form className="panel card" style={{ width: 'min(620px, 100%)' }} onSubmit={onSubmit}>
        <div className="hero" style={{ marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              {form.id ? 'Редактировать операцию' : 'Новая операция'}
            </h3>
          </div>
          <button className="button secondary" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Тип</label>
            <select
              value={form.type}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  type: event.target.value as 'income' | 'expense',
                  categoryId: '',
                }))
              }
            >
              <option value="expense">расход</option>
              <option value="income">доход</option>
            </select>
          </div>
          <div className="field">
            <label>Сумма</label>
            <input
              value={form.amount}
              onChange={(event) =>
                onChange((current) => ({ ...current, amount: event.target.value }))
              }
              required
            />
          </div>
          <div className="field">
            <label>Дата</label>
            <input
              type="date"
              value={form.occurredAt}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  occurredAt: event.target.value,
                }))
              }
              required
            />
          </div>
          <div className="field">
            <label>Категория</label>
            <select
              value={form.categoryId}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  categoryId: event.target.value,
                }))
              }
              required
            >
              <option value="">Выберите категорию</option>
              {filteredCategories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Статус</label>
            <select
              value={form.status}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  status: event.target.value as 'confirmed' | 'cancelled',
                }))
              }
            >
              <option value="confirmed">подтверждена</option>
              <option value="cancelled">отменена</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Комментарий</label>
            <textarea
              value={form.comment}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  comment: event.target.value,
                }))
              }
            />
          </div>
        </div>

        <div className="actions" style={{ marginTop: 20 }}>
          <button className="button" type="submit">
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}

type CategoryModalProps = {
  isOpen: boolean;
  form: CategoryFormState;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onChange: (
    updater: (current: CategoryFormState) => CategoryFormState,
  ) => void;
};

export function CategoryModal({
  isOpen,
  form,
  onClose,
  onSubmit,
  onChange,
}: CategoryModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 20, 20, 0.35)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <form className="panel card" style={{ width: 'min(520px, 100%)' }} onSubmit={onSubmit}>
        <div className="hero" style={{ marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              {form.id ? 'Редактировать категорию' : 'Новая категория'}
            </h3>
          </div>
          <button className="button secondary" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Название</label>
            <input
              value={form.name}
              onChange={(event) =>
                onChange((current) => ({ ...current, name: event.target.value }))
              }
              required
            />
          </div>
          <div className="field">
            <label>Тип</label>
            <select
              value={form.type}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  type: event.target.value as 'income' | 'expense',
                }))
              }
            >
              <option value="expense">расход</option>
              <option value="income">доход</option>
            </select>
          </div>
          {form.id ? (
            <div className="field">
              <label>Статус</label>
              <select
                value={form.isActive ? 'active' : 'inactive'}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    isActive: event.target.value === 'active',
                  }))
                }
              >
                <option value="active">активна</option>
                <option value="inactive">отключена</option>
              </select>
            </div>
          ) : null}
        </div>

        <div className="actions" style={{ marginTop: 20 }}>
          <button className="button" type="submit">
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}
