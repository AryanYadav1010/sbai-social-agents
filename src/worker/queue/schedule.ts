import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { addDays, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";

// Wall-clock schedule math, done correctly against an IANA timezone (DST
// transitions included) via date-fns-tz rather than hand-rolled offset
// arithmetic -- a naive UTC-offset calculation silently breaks twice a
// year around DST changes, which is exactly the kind of bug that's
// invisible until a client's posts fire an hour off.
export interface ScheduleConfig {
  timezone: string;
  allowedDays: number[]; // 0=Sunday..6=Saturday
  postingTimes: string[]; // "HH:mm", 24h, wall-clock in `timezone`
}

// Given "now" (UTC instant) and a schedule config, returns the next UTC
// instant at or after `now` that matches an allowed day + posting time.
// Deliberately bounded to searching 8 days ahead -- a schedule with an
// empty allowedDays/postingTimes is a misconfiguration, not something to
// spin forever looking for a match on.
export function computeNextRunAt(now: Date, config: ScheduleConfig): Date | null {
  if (config.allowedDays.length === 0 || config.postingTimes.length === 0) return null;

  const nowInZone = toZonedTime(now, config.timezone);

  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const candidateDay = addDays(nowInZone, dayOffset);
    if (!config.allowedDays.includes(candidateDay.getDay())) continue;

    // Sorted ascending by wall-clock time so the earliest still-upcoming
    // slot today wins regardless of the order an admin typed them in (the
    // dashboard just stores whatever comma-separated order was entered).
    const sortedTimes = [...config.postingTimes].sort((a, b) => {
      const [aH, aM] = a.split(":").map(Number);
      const [bH, bM] = b.split(":").map(Number);
      return aH * 60 + aM - (bH * 60 + bM);
    });

    for (const time of sortedTimes) {
      const [hoursStr, minutesStr] = time.split(":");
      const hours = Number(hoursStr);
      const minutes = Number(minutesStr);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) continue;

      let candidateZoned = setHours(candidateDay, hours);
      candidateZoned = setMinutes(candidateZoned, minutes);
      candidateZoned = setSeconds(candidateZoned, 0);
      candidateZoned = setMilliseconds(candidateZoned, 0);

      // Convert the wall-clock candidate (interpreted as being in
      // `config.timezone`) back to a real UTC instant -- this is the step
      // that's actually DST-aware; a spring-forward gap or fall-back
      // overlap is resolved correctly by the library rather than by us
      // guessing an offset.
      const candidateUtc = fromZonedTime(candidateZoned, config.timezone);
      if (candidateUtc.getTime() >= now.getTime()) {
        return candidateUtc;
      }
    }
  }

  return null;
}
