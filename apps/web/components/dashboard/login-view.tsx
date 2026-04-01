'use client';

import type { FormEvent } from 'react';

type LoginViewProps = {
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function LoginView({ error, onSubmit }: LoginViewProps) {
  return (
    <div className="login-shell">
      <form className="panel login-card" onSubmit={onSubmit}>
        <h1>Панель Denga</h1>
        <p>Вход только для администратора семейного пространства.</p>
        <div className="field">
          <label htmlFor="email">Электронная почта</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input id="password" name="password" type="password" required />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="actions">
          <button className="button" type="submit">
            Войти
          </button>
        </div>
      </form>
    </div>
  );
}
