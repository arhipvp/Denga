export const TELEGRAM_ADD_OPERATION_MENU_LABEL = 'Добавить операцию';
export const TELEGRAM_STATS_MENU_LABEL = 'Посмотреть статистику';
export const TELEGRAM_EXPENSE_CURRENT_MONTH_LABEL = 'Расходы за этот месяц';
export const TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK = 'stats:expense-current-month';

export function createTelegramMainMenuReplyMarkup() {
  return {
    keyboard: [[
      { text: TELEGRAM_ADD_OPERATION_MENU_LABEL },
      { text: TELEGRAM_STATS_MENU_LABEL },
    ]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function isTelegramStartCommand(text: string) {
  const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return command === '/start' || command?.startsWith('/start@') === true;
}

export function isTelegramSilentMenuAction(text: string) {
  return text.trim() === TELEGRAM_STATS_MENU_LABEL;
}

export function isTelegramAddOperationMenuAction(text: string) {
  return text.trim() === TELEGRAM_ADD_OPERATION_MENU_LABEL;
}

export function createTelegramStatsSubmenuReplyMarkup() {
  return {
    inline_keyboard: [[{
      text: TELEGRAM_EXPENSE_CURRENT_MONTH_LABEL,
      callback_data: TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK,
    }]],
  };
}
