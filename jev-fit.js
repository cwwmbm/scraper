// Mirrors pt1/lib/jev-fit.ts. Keep the request, levels, and rating scale in step with that file.

const FIT_LEVELS = [
  "Poor fit: the job conflicts with `jev_instruction`. If `jev_instruction` is empty or does not address the case, most core skills are missing, or recent roles are off even if older roles matched.",
  "Partial fit: if `jev_instruction` is empty or does not address the case, several important requirements are missing, or the applicant is clearly more senior than this role. A role at the same level as the applicant's current work is not overqualification.",
  "Good fit: the job matches `jev_instruction`. If `jev_instruction` is empty or does not address the case, the applicant could reasonably do the job, including when slightly underqualified, and recent experience is close to the role.",
  "Strong fit: the job is a clear match for `jev_instruction`. If `jev_instruction` is empty or does not address the case, recent experience covers the core work of the role without being substantially more senior than the role.",
];

const FIT_LABELS = ["Poor fit", "Partial fit", "Good fit", "Strong fit"];

const MAX_STATE_CHARS = 80_000;

const FIT_INSTRUCTIONS = {
  judgment:
    "How good a fit is `job` for the person described in `resume`, from that applicant's point of view? Apply `jev_instruction` first.",
  perspective:
    "Apply `jev_instruction` first. It overrides every other rule, including seniority, years, tools, location, and the default below. If `jev_instruction` is empty or does not address the case, use the default: a role is a good fit when the applicant could reasonably succeed in it. Being slightly underqualified — a bit short on years, seniority, or a few requirements — still counts as a good fit. Only a large gap in core skills should lower the rating. Being clearly overqualified should lower the rating, because the applicant would likely get bored. A role at the same level as the applicant's current work is not overqualification. Recent roles outweigh older ones: if earlier years match and recent work does not, recent work takes precedence.",
  ignore:
    "Ignore location, city, country, commute, relocation, timezone, and remote versus on-site when `jev_instruction` does not mention where the applicant will work. When `jev_instruction` does address location, remote work, or relocation, follow `jev_instruction` instead of ignoring those facts in `job.description`. When `jev_instruction` names a city, town, or suburb, treat that place as the whole metropolitan area it belongs to, including the principal city and the surrounding suburbs. A job in the principal city or in a neighboring suburb of that same metro is a location match. Apply a narrower boundary only when `jev_instruction` explicitly limits the search to one municipality.",
};

function labelForScore(score) {
  const index = Math.min(
    FIT_LABELS.length - 1,
    Math.max(0, Math.round(score))
  );
  return FIT_LABELS[index];
}

export function ratingFromScore(score) {
  return Math.min(1, Math.max(0, score / 3));
}

function jobState(resume, job, jevInstruction) {
  const title = job.title ?? "";
  const company = job.company ?? "";
  let description = job.description ?? "";
  const descriptionBudget =
    MAX_STATE_CHARS -
    resume.length -
    title.length -
    company.length -
    jevInstruction.length;
  if (description.length > descriptionBudget) {
    description = description.slice(0, Math.max(0, descriptionBudget));
  }

  return {
    jev_instruction: jevInstruction,
    resume,
    job: {
      title,
      company,
      description,
    },
  };
}

export async function scoreJobFit(resume, job, jevInstruction = "") {
  const url = process.env.OPENROUTER_DECISIONS_URL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!url || !apiKey || !model) {
    console.error("Jev fit scoring is missing OpenRouter configuration");
    return { fit: null, cost: 0 };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        state: jobState(resume, job, jevInstruction),
        questions: {
          fit: {
            type: "score",
            instructions: FIT_INSTRUCTIONS,
            criteria: [...FIT_LEVELS],
          },
        },
      }),
    });

    if (!response.ok) {
      console.error("Jev fit request failed", response.status);
      return { fit: null, cost: 0 };
    }

    const body = await response.json();
    const score = body?.answers?.fit?.score;
    const cost = typeof body?.usage?.cost === "number" ? body.usage.cost : 0;
    if (typeof score !== "number" || Number.isNaN(score)) {
      return { fit: null, cost };
    }

    return { fit: { label: labelForScore(score), score }, cost };
  } catch (error) {
    console.error("Jev fit request failed", error);
    return { fit: null, cost: 0 };
  }
}

export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
