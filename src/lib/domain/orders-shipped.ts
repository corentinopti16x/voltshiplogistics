export function countOrderWindows(dates: string[], now = new Date()) {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(startOfDay);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(startOfDay);
  monthStart.setDate(monthStart.getDate() - 29);

  let today = 0;
  let week = 0;
  let month = 0;
  for (const value of dates) {
    const date = new Date(`${value.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) continue;
    if (date >= startOfDay) today += 1;
    if (date >= weekStart) week += 1;
    if (date >= monthStart) month += 1;
  }
  return { today, week, month };
}
