/* Shared birthday date logic, small enough for the student first-paint graph. */
import { dhakaParts, nowEpoch } from './time.js';

const pad2 = value => String(value).padStart(2, '0');
const isLeapYear = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

export function birthMonthDay(birthDate) {
  const value = typeof birthDate === 'string' ? birthDate.trim() : '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : '';
}

export function isStudentBirthday(birthDate, now = nowEpoch()) {
  const stamp = birthMonthDay(birthDate);
  if (!stamp) return false;
  const date = new Date(Number(now));
  if (!Number.isFinite(date.getTime())) return false;
  const part = dhakaParts(date);
  const today = `${pad2(part.month)}-${pad2(part.day)}`;
  if (stamp === today) return true;
  return stamp === '02-29' && !isLeapYear(part.year) && today === '03-01';
}
