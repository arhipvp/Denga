'use client';

import type { ReactNode } from 'react';
import { sectionLabels } from '../../lib/dashboard';
import type { AuthState, Section, Settings } from '../../lib/types';

type LayoutProps = {
  auth: AuthState;
  section: Section;
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  onSectionChange: (section: Section) => void;
  children: ReactNode;
};

export function DashboardLayout({
  auth,
  section,
  settings,
  loading,
  error,
  onSectionChange,
  children,
}: LayoutProps) {
  return (
    <div className="page-shell">
      <div className="layout">
        <aside className="panel sidebar">
          <span className="badge info">Администратор</span>
          <div className="sidebar-brand">
            <h1>Denga</h1>
            <p>Единый центр управления семейными финансами, категориями, пользователями и системными журналами.</p>
          </div>
          <div className="nav">
            {(Object.keys(sectionLabels) as Section[]).map((item) => (
              <button
                key={item}
                className={section === item ? 'active' : ''}
                onClick={() => onSectionChange(item)}
                type="button"
              >
                <span>{sectionLabels[item]}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="content">
          <section className="panel hero-panel">
            <div className="hero-copy">
              <span className="eyebrow">Панель управления</span>
              <h2>{settings?.householdName ?? 'Загрузка...'}</h2>
              <p>{auth.user.email}</p>
            </div>
            <div className="hero-meta">
              <div className="hero-meta-card">
                <span>Базовая валюта</span>
                <strong>{settings?.defaultCurrency ?? 'EUR'}</strong>
              </div>
              <div className="hero-meta-card">
                <span>Telegram</span>
                <strong>{settings?.telegramMode === 'webhook' ? 'Вебхук' : 'Опрос'}</strong>
              </div>
            </div>
          </section>

          {loading ? <section className="panel card">Загрузка...</section> : null}
          {error ? <section className="panel card error">{error}</section> : null}

          {children}
        </main>
      </div>
    </div>
  );
}
