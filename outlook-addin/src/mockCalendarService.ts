export type MockAppointment = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string;
};

export type AvailabilityDay = {
  date: string;
  availableWindows: Array<{ startAt: string; endAt: string }>;
  busyAppointments: MockAppointment[];
};

export type MockCalendarSnapshot = {
  source: "MockCalendarService";
  timeZone: string;
  rangeStart: string;
  rangeEnd: string;
  appointments: MockAppointment[];
  availability: AvailabilityDay[];
};

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const zone = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00${zone}`;
}

function atLocalTime(day: Date, hour: number, minute = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

function nextMonday(from: Date): Date {
  const daysUntil = ((8 - from.getDay()) % 7) || 7;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + daysUntil, 0, 0, 0, 0);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export class MockCalendarService {
  async getAppointmentsForRange(rangeStart: Date, rangeEnd: Date): Promise<MockAppointment[]> {
    const monday = nextMonday(rangeStart);
    const dentistStart = atLocalTime(monday, 10);
    const dentistEnd = atLocalTime(monday, 11);
    const friday = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + ((5 - rangeStart.getDay() + 7) % 7 || 7));
    const checkInStart = atLocalTime(friday, 14);
    const checkInEnd = atLocalTime(friday, 14, 30);
    const fictional: MockAppointment[] = [
      { id: "mock-calendar-dentist", title: "Dentist appointment", startAt: localIso(dentistStart), endAt: localIso(dentistEnd), location: "Fictional calendar event" },
      { id: "mock-calendar-check-in", title: "Team check-in", startAt: localIso(checkInStart), endAt: localIso(checkInEnd), location: "Fictional calendar event" },
    ];
    return fictional.filter((appointment) => {
      const start = Date.parse(appointment.startAt);
      return start >= rangeStart.getTime() && start < rangeEnd.getTime();
    });
  }

  async getAvailabilityForRange(rangeStart: Date, rangeEnd: Date, appointments?: MockAppointment[]): Promise<AvailabilityDay[]> {
    const events = appointments ?? await this.getAppointmentsForRange(rangeStart, rangeEnd);
    const days: AvailabilityDay[] = [];
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
    const last = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());

    while (cursor < last) {
      if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
        const workStart = atLocalTime(cursor, 9);
        const workEnd = atLocalTime(cursor, 17);
        const busyAppointments = events
          .filter((event) => dateKey(new Date(event.startAt)) === dateKey(cursor))
          .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
        let cursorTime = workStart.getTime();
        const availableWindows: AvailabilityDay["availableWindows"] = [];
        for (const event of busyAppointments) {
          const busyStart = Math.max(Date.parse(event.startAt), workStart.getTime());
          const busyEnd = Math.min(Date.parse(event.endAt), workEnd.getTime());
          if (busyStart > cursorTime) availableWindows.push({ startAt: localIso(new Date(cursorTime)), endAt: localIso(new Date(busyStart)) });
          cursorTime = Math.max(cursorTime, busyEnd);
        }
        if (cursorTime < workEnd.getTime()) availableWindows.push({ startAt: localIso(new Date(cursorTime)), endAt: localIso(workEnd) });
        days.push({ date: dateKey(cursor), availableWindows, busyAppointments });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  async getSnapshot(rangeStart: Date, rangeEnd: Date): Promise<MockCalendarSnapshot> {
    const appointments = await this.getAppointmentsForRange(rangeStart, rangeEnd);
    const availability = await this.getAvailabilityForRange(rangeStart, rangeEnd, appointments);
    return {
      source: "MockCalendarService",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      rangeStart: localIso(rangeStart),
      rangeEnd: localIso(rangeEnd),
      appointments,
      availability,
    };
  }

  findConflicts(startAt: string, endAt: string, appointments: MockAppointment[]): MockAppointment[] {
    const start = Date.parse(startAt);
    const end = Date.parse(endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return appointments.filter((appointment) => overlaps(start, end, Date.parse(appointment.startAt), Date.parse(appointment.endAt)));
  }
}

export const mockCalendarService = new MockCalendarService();
