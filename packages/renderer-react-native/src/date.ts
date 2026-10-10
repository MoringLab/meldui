/** A date-only wire value is a local calendar date, independent of UTC offset. */
export function localCalendarDate(value?: string, time = "12:00:00"): Date {
  return value ? new Date(`${value}T${time}`) : new Date();
}
