export type MockAppointment = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string;
  eventType?: "meeting" | "appointment";
  attendees?: string[];
  description?: string;
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

function addLocalDays(from: Date, count: number): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + count, 0, 0, 0, 0);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export class MockCalendarService {
  async getAppointmentsForRange(rangeStart: Date, rangeEnd: Date): Promise<MockAppointment[]> {
    const today = addLocalDays(rangeStart, 0);
    const tomorrow = addLocalDays(today, 1);
    const friday = addLocalDays(today, (5 - today.getDay() + 7) % 7);
    const monday = nextMonday(today);
    const makeEvent = (input: {
      id: string; title: string; day: Date; start: [number, number]; end: [number, number];
      location: string; attendees: string[]; description: string; eventType?: "meeting" | "appointment";
    }): MockAppointment => ({
      id: `${input.id}-${dateKey(input.day)}`,
      title: input.title,
      startAt: localIso(atLocalTime(input.day, ...input.start)),
      endAt: localIso(atLocalTime(input.day, ...input.end)),
      location: input.location,
      attendees: input.attendees,
      description: input.description,
      eventType: input.eventType ?? "meeting",
    });
    const fictional: MockAppointment[] = [
      makeEvent({ id: "mock-atlas-steerco", title: "Project Atlas SteerCo", day: today, start: [10, 0], end: [10, 45], location: "Microsoft Teams (simulated)", attendees: ["Alex Morgan — Project Sponsor", "Priya Shah — Finance Lead"], description: "Decide the Phase 2 scope and review the delivery risks." }),
      makeEvent({ id: "mock-regional-checkin", title: "Regional Operations Check-in", day: today, start: [10, 30], end: [11, 0], location: "Meeting Room 2 (simulated)", attendees: ["Jordan Lee — Operations", "Sam Taylor — Delivery"], description: "Review regional delivery blockers and ownership." }),
      makeEvent({ id: "mock-northwind-renewal", title: "Northwind renewal prep", day: today, start: [14, 0], end: [14, 30], location: "Microsoft Teams (simulated)", attendees: ["Sofia Laine — Account Director", "Mina Patel — Commercial"], description: "Review January pricing options before the renewal discussion." }),
      makeEvent({ id: "mock-revenue-forecast", title: "Revenue forecast review", day: tomorrow, start: [9, 30], end: [10, 15], location: "Microsoft Teams (simulated)", attendees: ["James Carter — Finance", "Aisha Khan — Sales"], description: "Compare forecast assumptions and agree follow-up owners." }),
      makeEvent({ id: "mock-product-readiness", title: "Product launch readiness", day: tomorrow, start: [11, 0], end: [11, 45], location: "Meeting Room 4 (simulated)", attendees: ["Maya Chen — Product", "Noah Reed — Engineering"], description: "Confirm launch criteria, open risks and the decision deadline." }),
      makeEvent({ id: "mock-team-checkin", title: "Team check-in", day: friday, start: [14, 0], end: [14, 30], location: "Fictional calendar event", attendees: ["Jordan Lee", "Sam Taylor"], description: "Share weekly progress and raise blockers." }),
      makeEvent({ id: "mock-calendar-dentist", title: "Dentist appointment", day: monday, start: [10, 0], end: [11, 0], location: "Fictional calendar event", attendees: [], description: "Personal appointment.", eventType: "appointment" }),
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
