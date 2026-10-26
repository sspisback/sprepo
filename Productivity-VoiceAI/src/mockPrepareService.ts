import type { PriorityMeeting } from "./priorityDigestService";

export type MockPrepareResult = {
  simulated: true;
  meetingId: string;
  message: string;
  duplicate: boolean;
};

export class MockPrepareService {
  private readonly completed = new Map<string, MockPrepareResult>();
  private readonly inFlight = new Map<string, Promise<MockPrepareResult>>();
  private requests = 0;

  prepare(emailIdentity: string, meeting: PriorityMeeting): Promise<MockPrepareResult> {
    return this.simulate(emailIdentity, meeting.meetingId, `Meeting preparation requested for ${meeting.title}. This is a simulation; no brief or email was sent.`);
  }

  prepareForMeeting(meetingIdentity: string, meeting: { id: string; title: string }): Promise<MockPrepareResult> {
    return this.simulate(meetingIdentity, meeting.id, `Meeting preparation requested for ${meeting.title}. This is a simulation; no brief or email was sent.`);
  }

  private simulate(identity: string, meetingId: string, message: string): Promise<MockPrepareResult> {
    const key = `${identity}:${meetingId}`;
    const existing = this.completed.get(key);
    if (existing) return Promise.resolve({ ...existing, duplicate: true });
    const pending = this.inFlight.get(key);
    if (pending) return pending.then((result) => ({ ...result, duplicate: true }));

    this.requests += 1;
    const operation = new Promise<MockPrepareResult>((resolve) => {
      window.setTimeout(() => {
        const result: MockPrepareResult = {
          simulated: true,
          meetingId,
          message,
          duplicate: false,
        };
        this.completed.set(key, result);
        resolve(result);
      }, 650);
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  getInvocationCount(): number {
    return this.requests;
  }
}

export const mockPrepareService = new MockPrepareService();
