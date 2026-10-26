import type { ProposedTask } from "./taskPlanningService";

export type CreatedMockTask = Omit<ProposedTask, "schedulingConflicts"> & {
  mockTaskId: string;
  createdAt: string;
  service: "Mock Planner";
};

export type MockPlannerCreateResult = {
  idempotencyKey: string;
  created: CreatedMockTask[];
  errors: Array<{ taskId: string; message: string }>;
  duplicateApproval: boolean;
};

export class MockPlannerService {
  private nextId = 1;
  private readonly createdTasks: CreatedMockTask[] = [];
  private readonly results = new Map<string, MockPlannerCreateResult>();
  private readonly inFlight = new Map<string, Promise<MockPlannerCreateResult>>();
  private invocationCount = 0;

  createTasks(approvalKey: string, tasks: ProposedTask[]): Promise<MockPlannerCreateResult> {
    const previous = this.results.get(approvalKey);
    if (previous) return Promise.resolve({ ...previous, duplicateApproval: true });
    const pending = this.inFlight.get(approvalKey);
    if (pending) return pending.then((result) => ({ ...result, duplicateApproval: true }));

    this.invocationCount += 1;
    const operation = Promise.resolve().then(() => {
      const created: CreatedMockTask[] = [];
      const errors: MockPlannerCreateResult["errors"] = [];
      for (const task of tasks) {
        if (!task.title.trim() || !task.description.trim()) {
          errors.push({ taskId: task.taskId, message: "A title and description are required." });
          continue;
        }
        const mockTaskId = `mock-task-${String(this.nextId++).padStart(4, "0")}`;
        const createdTask: CreatedMockTask = {
          taskId: task.taskId,
          title: task.title,
          description: task.description,
          proposedDueDate: task.proposedDueDate,
          dependencies: [...task.dependencies],
          estimatedDurationMinutes: task.estimatedDurationMinutes,
          schedulingConstraints: [...task.schedulingConstraints],
          proposedSchedule: task.proposedSchedule ? { ...task.proposedSchedule } : null,
          mockTaskId,
          createdAt: new Date().toISOString(),
          service: "Mock Planner",
        };
        this.createdTasks.push(createdTask);
        created.push(createdTask);
      }
      const result = { idempotencyKey: approvalKey, created, errors, duplicateApproval: false };
      this.results.set(approvalKey, result);
      return result;
    }).finally(() => this.inFlight.delete(approvalKey));
    this.inFlight.set(approvalKey, operation);
    return operation;
  }

  listCreatedTasks(): CreatedMockTask[] {
    return this.createdTasks.map((task) => ({ ...task }));
  }

  getInvocationCount(): number {
    return this.invocationCount;
  }

  resetForTesting(): void {
    this.nextId = 1;
    this.createdTasks.length = 0;
    this.results.clear();
    this.inFlight.clear();
    this.invocationCount = 0;
  }
}

export const mockPlannerService = new MockPlannerService();
