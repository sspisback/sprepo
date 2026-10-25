export type SpecialistSkill = "orchestrator" | "task" | "meeting" | "research" | "lab";

const skillEndpoints: Record<SpecialistSkill, string> = {
  orchestrator: "/api/orchestrator/skill",
  task: "/api/task-planning/skill",
  meeting: "/api/meeting/skill",
  research: "/api/research/skill",
  lab: "/api/lab/skill",
};

export async function loadSpecialistSkill(agent: SpecialistSkill): Promise<string> {
  const response = await fetch(skillEndpoints[agent], { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load the ${agent} skill (HTTP ${response.status}).`);
  const skill = (await response.text()).trim();
  if (!skill) throw new Error(`The ${agent} skill is empty.`);
  return skill;
}
