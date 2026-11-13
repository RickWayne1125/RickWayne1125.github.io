const CACHE_TTL = 15 * 60 * 1000;
const LIMIT = 6;
const REPO_PATTERN = /^[a-z\d_.-]+\/[a-z\d_.-]+$/i;

function githubUrl(value, fallback) {
  try {
    const url = new URL(value);
    if (url.origin === "https://github.com" && !url.username && !url.password) return url.href;
  } catch {
    // Use a link constructed from the repository and event number instead.
  }
  return fallback;
}

export function normalizeEvents(events, username) {
  if (!Array.isArray(events)) return [];
  const seen = new Set();
  const entries = [];

  for (const event of [...events].sort((a, b) => Date.parse(b?.created_at) - Date.parse(a?.created_at))) {
    const repo = event?.repo?.name;
    if (event?.public !== true || event.actor?.login?.toLowerCase() !== username.toLowerCase() || !REPO_PATTERN.test(repo || "")) continue;
    if (!Number.isFinite(Date.parse(event.created_at))) continue;

    const payload = event.payload || {};
    const base = `https://github.com/${repo}`;
    const date = new Date(event.created_at).toISOString();
    const day = date.slice(0, 10);
    const pull = payload.pull_request;
    const issue = payload.issue;
    const number = pull?.number || issue?.number || payload.number;
    const validNumber = Number.isSafeInteger(number) && number > 0;
    let title;
    let url;
    let key;

    switch (event.type) {
      case "PushEvent": {
        if (typeof payload.ref !== "string" || !payload.ref.startsWith("refs/heads/")) continue;
        const branch = payload.ref.slice("refs/heads/".length);
        title = `Pushed to ${branch}`;
        url = /^[a-f\d]{40,64}$/i.test(payload.head || "") ? `${base}/commit/${payload.head}` : base;
        key = `push:${repo}:${branch}:${day}`;
        break;
      }
      case "PullRequestEvent": {
        const action = payload.action === "closed" && pull?.merged === true ? "merged" : payload.action;
        const verb = { opened: "Opened", reopened: "Reopened", closed: "Closed", merged: "Merged" }[action];
        if (typeof verb !== "string" || !validNumber) continue;
        title = `${verb} pull request #${number}${pull?.title ? `: ${pull.title}` : ""}`;
        url = `${base}/pull/${number}`;
        key = `pull:${repo}:${number}:${action}:${day}`;
        break;
      }
      case "IssuesEvent": {
        const verb = { opened: "Opened", reopened: "Reopened", closed: "Closed" }[payload.action];
        if (typeof verb !== "string" || !validNumber) continue;
        title = `${verb} issue #${number}${issue?.title ? `: ${issue.title}` : ""}`;
        url = `${base}/issues/${number}`;
        key = `issue:${repo}:${number}:${payload.action}:${day}`;
        break;
      }
      case "IssueCommentEvent":
      case "PullRequestReviewCommentEvent":
      case "PullRequestReviewEvent": {
        const review = event.type === "PullRequestReviewEvent";
        const validAction = review ? ["created", "submitted"].includes(payload.action) : payload.action === "created";
        if (!validAction || !validNumber) continue;
        const isPull = !!pull || !!issue?.pull_request;
        const subject = isPull ? "pull request" : "issue";
        const subjectTitle = pull?.title || issue?.title;
        title = `${review ? "Reviewed" : "Commented on"} ${subject} #${number}${subjectTitle ? `: ${subjectTitle}` : ""}`;
        url = githubUrl(payload.review?.html_url || payload.comment?.html_url, `${base}/${isPull ? "pull" : "issues"}/${number}`);
        key = `${review ? "review" : "comment"}:${repo}:${subject}:${number}:${day}`;
        break;
      }
      case "ReleaseEvent": {
        if (payload.action !== "published" || !payload.release?.tag_name) continue;
        const tag = payload.release.tag_name;
        title = `Published release ${payload.release.name || tag}`;
        url = `${base}/releases/tag/${encodeURIComponent(tag)}`;
        key = `release:${repo}:${tag}`;
        break;
      }
      default:
        continue;
    }

    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ date, title, repo, url });
    if (entries.length === LIMIT) break;
  }
  return entries;
}

function validEntries(entries) {
  return (
    Array.isArray(entries) &&
    entries.length > 0 &&
    entries.every(
      (entry) =>
        entry &&
        Number.isFinite(Date.parse(entry.date)) &&
        typeof entry.title === "string" &&
        REPO_PATTERN.test(entry.repo || "") &&
        !!githubUrl(entry.url, null)
    )
  );
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function renderActivity(section, entries, fetchedAt) {
  const list = section.querySelector(".github-activity-list");
  const rows = entries.slice(0, LIMIT).map((entry) => {
    const row = document.createElement("li");
    row.className = "github-activity-item";
    const date = document.createElement("time");
    date.className = "github-activity-date";
    date.dateTime = entry.date;
    date.textContent = formatDate(entry.date);
    const content = document.createElement("div");
    content.className = "github-activity-content";
    const link = document.createElement("a");
    link.className = "github-activity-title";
    link.href = entry.url;
    link.textContent = entry.title;
    const repo = document.createElement("div");
    repo.className = "github-activity-repo";
    repo.textContent = entry.repo;
    content.append(link, repo);
    row.append(date, content);
    return row;
  });
  list.replaceChildren(...rows);
  section.querySelector("[data-github-activity-updated]").textContent = `Updated ${formatDate(fetchedAt)}.`;
}

export async function loadActivity(section, { fetcher = globalThis.fetch, storage, now = Date.now() } = {}) {
  const username = section.dataset.githubUsername;
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(username || "")) return;
  const key = `github-activity:v1:${username}`;
  const snapshotAt = Date.parse(section.dataset.githubSnapshotAt) || 0;
  let cache;
  try {
    storage ??= globalThis.localStorage;
    cache = JSON.parse(storage.getItem(key));
    if (validEntries(cache?.entries) && Number.isFinite(cache.fetchedAt) && cache.fetchedAt >= snapshotAt && cache.fetchedAt <= now) {
      renderActivity(section, cache.entries, cache.fetchedAt);
      if (now - cache.fetchedAt < CACHE_TTL) return;
    }
  } catch {
    // Storage may be disabled; the server-rendered snapshot stays available.
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(`https://api.github.com/users/${username}/events/public?per_page=100`, {
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) return;
    const entries = normalizeEvents(await response.json(), username);
    if (!entries.length) return;
    renderActivity(section, entries, now);
    try {
      storage?.setItem(key, JSON.stringify({ fetchedAt: now, entries }));
    } catch {
      // A full or unavailable cache should not prevent displaying fresh data.
    }
  } catch {
    // Keep the cached or server-rendered activity on network/API failures.
  } finally {
    clearTimeout(timeout);
  }
}

if (typeof document !== "undefined") {
  const section = document.querySelector("[data-github-username]");
  if (section) loadActivity(section);
}
