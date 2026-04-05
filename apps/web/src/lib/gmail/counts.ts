import type { FilterCondition } from "@g-spot/types/filters";

import { buildGmailSearchQuery } from "./api";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailProfileResponse = {
  threadsTotal: number;
};

type GmailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  threadsTotal?: number;
  threadsUnread?: number;
};

type GmailLabelsResponse = {
  labels?: GmailLabel[];
};

type GmailThreadListResponse = {
  resultSizeEstimate?: number;
};

export type GmailThreadCount = {
  count: number;
  isExact: boolean;
};

type ReadState = "all" | "read" | "unread";

type ExactCountPlan =
  | { kind: "unsupported" }
  | { kind: "mailbox"; readState: ReadState }
  | { kind: "label"; labelName: string; readState: ReadState };

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function mapSearchLocationToLabel(value: string): string | null {
  switch (normalizeToken(value)) {
    case "inbox":
      return "INBOX";
    case "sent":
      return "SENT";
    case "spam":
      return "SPAM";
    case "trash":
      return "TRASH";
    case "starred":
      return "STARRED";
    case "important":
      return "IMPORTANT";
    case "unread":
      return "UNREAD";
    default:
      return null;
  }
}

function mapCategoryToLabel(value: string): string | null {
  switch (normalizeToken(value)) {
    case "primary":
      return "CATEGORY_PERSONAL";
    case "social":
      return "CATEGORY_SOCIAL";
    case "promotions":
      return "CATEGORY_PROMOTIONS";
    case "updates":
      return "CATEGORY_UPDATES";
    case "forums":
      return "CATEGORY_FORUMS";
    default:
      return null;
  }
}

function deriveExactCountPlan(filters: FilterCondition[]): ExactCountPlan {
  let labelName: string | null = null;
  let readState: ReadState = "all";

  const setLabelName = (nextLabelName: string): boolean => {
    if (labelName === null) {
      labelName = nextLabelName;
      return true;
    }

    return normalizeToken(labelName) === normalizeToken(nextLabelName);
  };

  const setReadState = (nextReadState: Exclude<ReadState, "all">): boolean => {
    if (readState === "all") {
      readState = nextReadState;
      return true;
    }

    return readState === nextReadState;
  };

  for (const filter of filters) {
    if (filter.logic === "or" || filter.operator !== "is") {
      return { kind: "unsupported" };
    }

    switch (filter.field) {
      case "label":
        if (!setLabelName(filter.value)) return { kind: "unsupported" };
        break;
      case "in": {
        const mapped = mapSearchLocationToLabel(filter.value);
        if (!mapped || !setLabelName(mapped)) return { kind: "unsupported" };
        break;
      }
      case "category": {
        const mapped = mapCategoryToLabel(filter.value);
        if (!mapped || !setLabelName(mapped)) return { kind: "unsupported" };
        break;
      }
      case "is_unread":
        if (filter.value !== "true" || !setReadState("unread")) {
          return { kind: "unsupported" };
        }
        break;
      case "is_read":
        if (filter.value !== "true" || !setReadState("read")) {
          return { kind: "unsupported" };
        }
        break;
      case "is_starred":
        if (filter.value !== "true" || !setLabelName("STARRED")) {
          return { kind: "unsupported" };
        }
        break;
      case "is_important":
        if (filter.value !== "true" || !setLabelName("IMPORTANT")) {
          return { kind: "unsupported" };
        }
        break;
      default:
        return { kind: "unsupported" };
    }
  }

  if (labelName === null) {
    return { kind: "mailbox", readState };
  }

  return { kind: "label", labelName, readState };
}

async function fetchGmailJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Gmail API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

async function fetchGmailProfile(accessToken: string): Promise<GmailProfileResponse> {
  return fetchGmailJson<GmailProfileResponse>(`${GMAIL_API}/profile`, accessToken);
}

async function fetchGmailLabels(accessToken: string): Promise<GmailLabel[]> {
  const data = await fetchGmailJson<GmailLabelsResponse>(`${GMAIL_API}/labels`, accessToken);
  return data.labels ?? [];
}

async function fetchGmailLabel(accessToken: string, labelId: string): Promise<GmailLabel> {
  return fetchGmailJson<GmailLabel>(
    `${GMAIL_API}/labels/${encodeURIComponent(labelId)}`,
    accessToken,
  );
}

function findMatchingLabel(labels: GmailLabel[], labelName: string): GmailLabel | null {
  const needle = normalizeToken(labelName);

  return labels.find((label) => {
    return normalizeToken(label.id) === needle || normalizeToken(label.name) === needle;
  }) ?? null;
}

function getUnreadThreadCount(label: GmailLabel | null | undefined): number {
  if (!label) return 0;
  return label.threadsUnread ?? label.threadsTotal ?? 0;
}

async function resolveLabelWithStats(
  accessToken: string,
  labels: GmailLabel[],
  labelName: string,
): Promise<GmailLabel | null> {
  const matched = findMatchingLabel(labels, labelName);
  if (!matched) return null;

  if (matched.threadsTotal !== undefined || matched.threadsUnread !== undefined) {
    return matched;
  }

  return fetchGmailLabel(accessToken, matched.id);
}

async function getExactCountFromPlan(
  accessToken: string,
  plan: ExactCountPlan,
  profile: GmailProfileResponse,
  labels: GmailLabel[],
): Promise<GmailThreadCount | null> {
  const unreadLabel = await resolveLabelWithStats(accessToken, labels, "UNREAD");
  const unreadMailboxCount = getUnreadThreadCount(unreadLabel);

  if (plan.kind === "mailbox") {
    if (plan.readState === "all") {
      return { count: profile.threadsTotal ?? 0, isExact: true };
    }

    if (plan.readState === "unread") {
      return { count: unreadMailboxCount, isExact: true };
    }

    return {
      count: Math.max(0, (profile.threadsTotal ?? 0) - unreadMailboxCount),
      isExact: true,
    };
  }

  if (plan.kind === "label") {
    const label = await resolveLabelWithStats(accessToken, labels, plan.labelName);
    if (!label) return { count: 0, isExact: true };

    const total = label.threadsTotal ?? 0;
    const unread = getUnreadThreadCount(label);

    if (plan.readState === "all") {
      return { count: total, isExact: true };
    }

    if (plan.readState === "unread") {
      if (normalizeToken(label.id) === "unread") {
        return { count: total, isExact: true };
      }

      return { count: unread, isExact: true };
    }

    if (normalizeToken(label.id) === "unread") {
      return { count: 0, isExact: true };
    }

    return { count: Math.max(0, total - unread), isExact: true };
  }

  return null;
}

async function fetchEstimatedThreadCount(
  accessToken: string,
  filters: FilterCondition[],
): Promise<GmailThreadCount> {
  const query = buildGmailSearchQuery(filters);
  const params = new URLSearchParams({ maxResults: "1" });
  if (query) params.set("q", query);

  const data = await fetchGmailJson<GmailThreadListResponse>(
    `${GMAIL_API}/threads?${params.toString()}`,
    accessToken,
  );

  return {
    count: data.resultSizeEstimate ?? 0,
    isExact: false,
  };
}

export async function fetchBestEffortGmailThreadCount(
  accessToken: string,
  filters: FilterCondition[],
): Promise<GmailThreadCount> {
  const plan = deriveExactCountPlan(filters);

  if (plan.kind === "unsupported") {
    return fetchEstimatedThreadCount(accessToken, filters);
  }

  const [profile, labels] = await Promise.all([
    fetchGmailProfile(accessToken),
    fetchGmailLabels(accessToken),
  ]);

  return await getExactCountFromPlan(accessToken, plan, profile, labels)
    ?? fetchEstimatedThreadCount(accessToken, filters);
}
