'use client';

import { useMemo, useState } from 'react';
import { DataTable, TablePagination, TableSearch } from './data-table';
import { MoneyText, TransactionStatusBadge, TransactionTypePill } from './section-shared';
import { formatDate, formatMoney, formatMonthLabel, formatShare, formatSignedMoney } from '../../lib/formatters';
import { useClientTable } from '../../lib/client-table';
import type { SortDirection, Summary, Transaction } from '../../lib/types';

export function OverviewSection({
  summary,
  currency,
}: {
  summary: Summary;
  currency: string;
}) {
  const monthlyScale = Math.max(
    ...summary.monthly.flatMap((item) => [item.income, item.expense, Math.abs(item.net)]),
    1,
  );
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'occurredAt' | 'amount' | 'type' | 'status'>('occurredAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const recentTable = useClientTable({
    rows: summary.recent,
    search,
    getSearchValue: (item) =>
      `${item.comment ?? ''} ${item.category?.displayPath ?? ''} ${item.sourceMessage?.type ?? ''} ${item.amount}`,
    sortBy,
    sortDir,
    page,
    pageSize: 5,
    comparators: {
      occurredAt: (left, right) => left.occurredAt.localeCompare(right.occurredAt),
      amount: (left, right) => Number(left.amount) - Number(right.amount),
      type: (left, right) => left.type.localeCompare(right.type),
      status: (left, right) => left.status.localeCompare(right.status),
    },
  });

  const recentColumns = useMemo(
    () => [
      {
        key: 'occurredAt',
        label: 'Дата',
        sortable: true,
        render: (item: Transaction) => formatDate(item.occurredAt),
      },
      {
        key: 'type',
        label: 'Тип',
        sortable: true,
        render: (item: Transaction) => <TransactionTypePill type={item.type} />,
      },
      {
        key: 'amount',
        label: 'Сумма',
        sortable: true,
        render: (item: Transaction) => (
          <MoneyText
            value={item.amount}
            currency={item.currency}
            tone={item.type === 'INCOME' ? 'income' : 'expense'}
          />
        ),
      },
      {
        key: 'category',
        label: 'Категория',
        render: (item: Transaction) => item.category?.displayPath ?? 'Не определена',
      },
      {
        key: 'status',
        label: 'Статус',
        sortable: true,
        render: (item: Transaction) => <TransactionStatusBadge status={item.status} />,
      },
      {
        key: 'comment',
        label: 'Комментарий',
        render: (item: Transaction) => item.comment?.trim() ? item.comment : '—',
      },
      {
        key: 'source',
        label: 'Источник',
        render: (item: Transaction) => item.sourceMessage?.type ?? '—',
      },
    ],
    [],
  );

  const handleSortChange = (nextSortBy: string) => {
    const resolved = nextSortBy as typeof sortBy;
    setPage(1);
    if (resolved === sortBy) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(resolved);
    setSortDir('desc');
  };

  return (
    <>
      <section className="kpi-grid">
        <article className="panel metric-card metric-card--income">
          <span>Доходы за месяц</span>
          <strong><MoneyText value={summary.totals.currentPeriod.income} currency={currency} tone="income" /></strong>
          <small className={summary.diffs.income >= 0 ? 'metric-delta positive' : 'metric-delta negative'}>
            К прошлому месяцу: {formatSignedMoney(summary.diffs.income, { currency })}
          </small>
        </article>
        <article className="panel metric-card metric-card--expense">
          <span>Расходы за месяц</span>
          <strong><MoneyText value={summary.totals.currentPeriod.expense} currency={currency} tone="expense" /></strong>
          <small className={summary.diffs.expense <= 0 ? 'metric-delta positive' : 'metric-delta negative'}>
            К прошлому месяцу: {formatSignedMoney(summary.diffs.expense, { currency })}
          </small>
        </article>
        <article className="panel metric-card">
          <span>Баланс</span>
          <strong><MoneyText value={summary.totals.currentPeriod.balance} currency={currency} tone="balance" /></strong>
          <small className={summary.diffs.balance >= 0 ? 'metric-delta positive' : 'metric-delta negative'}>
            К прошлому месяцу: {formatSignedMoney(summary.diffs.balance, { currency })}
          </small>
        </article>
        <article className="panel metric-card">
          <span>Подтвержденные операции</span>
          <strong>{summary.counts.operations}</strong>
          <small className="metric-delta neutral">
            Доходов: {summary.counts.income}, расходов: {summary.counts.expense}, отмен: {summary.counts.cancelled}
          </small>
        </article>
      </section>

      <section className="insight-grid">
        <article className="panel card">
          <div className="section-intro">
            <h3>Средние значения</h3>
            <p>Текущий календарный месяц.</p>
          </div>
          <div className="stack-list">
            <article className="stack-row">
              <span>Средний доход</span>
              <strong><MoneyText value={summary.average.income} currency={currency} tone="income" /></strong>
            </article>
            <article className="stack-row">
              <span>Средний расход</span>
              <strong><MoneyText value={summary.average.expense} currency={currency} tone="expense" /></strong>
            </article>
            <article className="stack-row">
              <span>Средняя операция</span>
              <strong><MoneyText value={summary.average.transaction} currency={currency} tone="neutral" /></strong>
            </article>
          </div>
        </article>

        <article className="panel card">
          <div className="section-intro">
            <h3>Сравнение периодов</h3>
            <p>Текущий месяц против предыдущего.</p>
          </div>
          <div className="stack-list">
            <div className="stack-row">
              <span>Доходы</span>
              <strong>
                {formatMoney(summary.totals.currentPeriod.income, { currency })} / {formatMoney(summary.totals.previousPeriod.income, { currency })}
              </strong>
            </div>
            <div className="stack-row">
              <span>Расходы</span>
              <strong>
                {formatMoney(summary.totals.currentPeriod.expense, { currency })} / {formatMoney(summary.totals.previousPeriod.expense, { currency })}
              </strong>
            </div>
            <div className="stack-row">
              <span>Баланс</span>
              <strong>
                {formatMoney(summary.totals.currentPeriod.balance, { currency })} / {formatMoney(summary.totals.previousPeriod.balance, { currency })}
              </strong>
            </div>
          </div>
        </article>
      </section>

      <section className="panel card">
        <div className="section-intro">
          <h3>Динамика за 6 месяцев</h3>
          <p>Доходы, расходы и итог по месяцам.</p>
        </div>
        <div className="trend-grid">
          {summary.monthly.map((item) => (
            <article key={item.month} className="trend-card">
              <span>{formatMonthLabel(item.month)}</span>
              <div className="trend-bars">
                <div>
                  <div className="trend-label">Доходы: {formatMoney(item.income, { currency })}</div>
                  <div className="trend-bar"><div className="trend-bar-fill income" style={{ width: `${(item.income / monthlyScale) * 100}%` }} /></div>
                </div>
                <div>
                  <div className="trend-label">Расходы: {formatMoney(item.expense, { currency })}</div>
                  <div className="trend-bar"><div className="trend-bar-fill expense" style={{ width: `${(item.expense / monthlyScale) * 100}%` }} /></div>
                </div>
              </div>
              <strong className={item.net >= 0 ? 'trend-net positive' : 'trend-net negative'}>
                {formatSignedMoney(item.net, { currency })}
              </strong>
            </article>
          ))}
        </div>
      </section>

      <section className="insight-grid">
        <article className="panel card">
          <div className="section-intro">
            <h3>Топ категорий расходов</h3>
            <p>Самые заметные статьи текущего месяца.</p>
          </div>
          {summary.topExpenseCategories.length > 0 ? (
            <div className="category-breakdown">
              {summary.topExpenseCategories.map((item) => (
                <article key={`expense-${item.categoryId ?? item.categoryName}`} className="category-breakdown-row">
                  <div>
                    <strong>{item.categoryName}</strong>
                    <span>{formatShare(item.share)}</span>
                  </div>
                  <MoneyText value={item.amount} currency={currency} tone="expense" />
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-copy">В этом месяце подтвержденных расходов пока нет.</p>
          )}
        </article>

        <article className="panel card">
          <div className="section-intro">
            <h3>Топ категорий доходов</h3>
            <p>Наиболее значимые источники текущего месяца.</p>
          </div>
          {summary.topIncomeCategories.length > 0 ? (
            <div className="category-breakdown">
              {summary.topIncomeCategories.map((item) => (
                <article key={`income-${item.categoryId ?? item.categoryName}`} className="category-breakdown-row">
                  <div>
                    <strong>{item.categoryName}</strong>
                    <span>{formatShare(item.share)}</span>
                  </div>
                  <MoneyText value={item.amount} currency={currency} tone="income" />
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-copy">В этом месяце подтвержденных доходов пока нет.</p>
          )}
        </article>
      </section>

      <section className="panel card">
        <div className="table-card-header">
          <div className="section-intro">
            <h3>Последние операции</h3>
            <p>Поиск и сортировка по ключевым полям.</p>
          </div>
          <TableSearch
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Категория, комментарий, источник"
          />
        </div>
        <DataTable
          columns={recentColumns}
          rows={recentTable.rows}
          rowKey={(item) => item.id}
          emptyTitle="Операции не найдены"
          emptyDescription="Измените поисковый запрос или дождитесь новых данных."
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
        />
        <TablePagination
          page={recentTable.page}
          pageSize={recentTable.pageSize}
          total={recentTable.total}
          onPageChange={setPage}
        />
      </section>
    </>
  );
}
