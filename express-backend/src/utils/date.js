/**
 * Calculates the date of the upcoming Sunday at 23:59:59.
 * If today is Sunday, it returns today.
 * @returns {Date}
 */
export function getUpcomingSunday() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentDay = today.getDay(); // 0 for Sunday, 1 for Monday, etc.

  // Calculate days until next Sunday.
  // If today is Sunday (0), we want 0.
  // If today is Monday (1), we want 6 (7-1).
  // Formula: (7 - currentDay) % 7
  const daysUntilSunday = (7 - currentDay) % 7;

  const upcomingSunday = new Date(today);
  upcomingSunday.setDate(today.getDate() + daysUntilSunday);

  // Set time to the very end of the day
  upcomingSunday.setHours(23, 59, 59, 999);

  return upcomingSunday;
}