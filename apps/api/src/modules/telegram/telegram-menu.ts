export const TELEGRAM_STATS_MENU_LABEL = 'Посмотреть статистику';

export function createTelegramMainMenuReplyMarkup() {
  return {
    keyboard: [[{ text: TELEGRAM_STATS_MENU_LABEL }]],
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
