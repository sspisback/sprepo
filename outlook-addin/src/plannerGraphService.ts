/**
 * Standalone Microsoft Graph client for Planner basic plans.
 *
 * Authentication is deliberately injected. The Outlook add-in does not yet
 * have an Entra app registration or Graph token flow, so this module does not
 * request credentials, persist tokens, or make network calls until a method is
 * called with a valid delegated access token.
 */

const graphBaseUrl = "https://graph.microsoft.com/v1.0";

export type PlannerPlan = {
  id: string;
  title: string;
  owner?: string;
};

export type PlannerBucket = {
  id: string;
  name: string;
  planId: string;
};

export type PlannerTask = {
  id: string;
  title: string;
  planId: string;
  bucketId?: string;
  dueDateTime?: string;
  percentComplete?: number;
};

export type CreatePlannerTask = {
  planId: string;
  bucketId: string;
  title: string;
  dueDateTime?: string;
};

type GraphCollection<T> = {
  value: T[];
  "@odata.nextLink"?: string;
};

type GraphErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class PlannerGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly graphCode?: string,
  ) {
    super(message);
    this.name = "PlannerGraphError";
  }
}

export class PlannerGraphService {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  /** Lists tasks assigned to the signed-in user. Requires delegated Tasks.Read or Tasks.ReadWrite. */
  listMyTasks(): Promise<PlannerTask[]> {
    return this.getCollection<PlannerTask>("/me/planner/tasks");
  }

  /** Lists Planner plans available to the signed-in user. Requires delegated Planner task permissions. */
  listMyPlans(): Promise<PlannerPlan[]> {
    return this.getCollection<PlannerPlan>("/me/planner/plans");
  }

  /** Lists buckets in a plan the signed-in user can access. */
  listBuckets(planId: string): Promise<PlannerBucket[]> {
    return this.getCollection<PlannerBucket>(`/planner/plans/${encodeURIComponent(planId)}/buckets`);
  }

  /** Creates one task in an existing basic plan and bucket. This mutates Planner. */
  async createTask(input: CreatePlannerTask): Promise<PlannerTask> {
    if (!input.planId.trim() || !input.bucketId.trim()) {
      throw new Error("Choose an existing Planner plan and bucket before creating a task.");
    }
    if (!input.title.trim()) throw new Error("A Planner task title is required.");

    return this.request<PlannerTask>("/planner/tasks", {
      method: "POST",
      body: JSON.stringify({
        planId: input.planId,
        bucketId: input.bucketId,
        title: input.title.trim(),
        ...(input.dueDateTime ? { dueDateTime: input.dueDateTime } : {}),
      }),
    });
  }

  private async getCollection<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let nextUrl: string | undefined = `${graphBaseUrl}${path}`;

    while (nextUrl) {
      const page: GraphCollection<T> = await this.request<GraphCollection<T>>(nextUrl);
      items.push(...(page.value ?? []));
      nextUrl = page["@odata.nextLink"];
    }

    return items;
  }

  private async request<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const token = (await this.getAccessToken()).trim();
    if (!token) {
      throw new PlannerGraphError(
        "Microsoft Graph access token is missing. Sign in and grant the required Planner permission first.",
        401,
        "MissingAccessToken",
      );
    }

    const response = await fetch(pathOrUrl.startsWith("https://") ? pathOrUrl : `${graphBaseUrl}${pathOrUrl}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      let payload: GraphErrorPayload = {};
      try {
        payload = await response.json() as GraphErrorPayload;
      } catch {
        // Keep the HTTP status as a useful error when Graph returns no JSON.
      }
      const graphMessage = payload.error?.message;
      const message = response.status === 401 || response.status === 403
        ? `${graphMessage || "Microsoft Graph denied this request."} Check the sign-in and delegated Planner permission consent.`
        : graphMessage || `Microsoft Graph returned HTTP ${response.status}.`;
      throw new PlannerGraphError(message, response.status, payload.error?.code);
    }

    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
}
