/**
 * Calculates the date of the next upcoming Sunday at 23:59:59.
 * @returns {Date}
 */
export function getUpcomingSunday() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentDay = today.getDay(); // 0 for Sunday, 1 for Monday, etc.
  
  // Calculate days until next Sunday
  // If today is Sunday (0), it should be 7 days to the *next* Sunday.
  const daysUntilSunday = 7 - currentDay;
  
  const upcomingSunday = new Date(today);
  upcomingSunday.setDate(today.getDate() + daysUntilSunday);
  
  // Set time to the very end of the day
  upcomingSunday.setHours(23, 59, 59, 999);
  
  return upcomingSunday;
}
