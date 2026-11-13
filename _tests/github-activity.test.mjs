import assert from "node:assert/strict";
import { test } from "node:test";
import { loadActivity, normalizeEvents } from "../assets/js/github-activity.js";

const username = "RickWayne1125";
const now = Date.parse("2026-11-12T12:00:00Z");
const repo = "Human-Agent-Society/reef";
const event = (type, payload, date = "2026-11-12T10:00:00Z") => ({
  public: true,
  actor: { login: username },
  repo: { name: repo },
  type,
  payload,
  created_at: date,
});

test("handles sparse current PR payloads and distinguishes closed from merged", () => {
  for (const [action, merged, expected] of [
    ["opened", undefined, "Opened"],
    ["merged", undefined, "Merged"],
    ["closed", undefined, "Closed"],
    ["closed", true, "Merged"],
  ]) {
    const [entry] = normalizeEvents([event("PullRequestEvent", { action, number: 1373, pull_request: { merged } })], username);
    assert.equal(entry.title, `${expected} pull request #1373`);
    assert.equal(entry.url, `https://github.com/${repo}/pull/1373`);
  }
});

test("sorts events and coalesces pushes to a branch on the same day", () => {
  const push = (hour, head) => event("PushEvent", { ref: "refs/heads/main", head }, `2026-11-12T${hour}:00:00Z`);
  const entries = normalizeEvents([push("08", "a".repeat(40)), push("11", "b".repeat(40)), push("09", "c".repeat(40))], username);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Pushed to main");
  assert.ok(entries[0].url.endsWith("b".repeat(40)));
});

test("only shows this user's public, meaningful, valid events, capped at six", () => {
  const opened = event("IssuesEvent", { action: "opened", issue: { number: 1, title: "A fix" } });
  const ignored = [
    { ...opened, public: false },
    { ...opened, actor: { login: "someone-else" } },
    { ...opened, repo: { name: "../../malformed" } },
    { ...opened, created_at: "invalid" },
    event("IssuesEvent", { action: "labeled", issue: { number: 1 } }),
    event("WatchEvent", { action: "started" }),
    event("PushEvent", { ref: 123 }),
    null,
  ];
  assert.deepEqual(normalizeEvents(ignored, username), []);
  const many = Array.from({ length: 10 }, (_, index) => event("IssuesEvent", { action: "opened", issue: { number: index + 1 } }));
  assert.equal(normalizeEvents(many, username).length, 6);
});

test("uses safe GitHub links for comments and preserves titles as plain text", () => {
  const title = '<img src=x onerror="alert(1)">';
  const [entry] = normalizeEvents(
    [event("IssueCommentEvent", { action: "created", issue: { number: 2, title }, comment: { html_url: "javascript:alert(1)" } })],
    username
  );
  assert.equal(entry.url, `https://github.com/${repo}/issues/2`);
  assert.equal(entry.title, `Commented on issue #2: ${title}`);
});

test("supports both current and legacy review actions with sparse payloads", () => {
  for (const action of ["created", "submitted"]) {
    const [entry] = normalizeEvents([event("PullRequestReviewEvent", { action, pull_request: { number: 859 } })], username);
    assert.equal(entry.title, "Reviewed pull request #859");
    assert.equal(entry.url, `https://github.com/${repo}/pull/859`);
  }
});

// A minimal DOM fixture verifies network/cache behavior without requiring a browser.
function element() {
  return {
    children: [],
    textContent: "",
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
  };
}

function fixture(cache, snapshotAt = "2026-11-12T00:00:00Z") {
  const list = element();
  list.children = ["static fallback"];
  const updated = element();
  updated.textContent = "Static update date";
  const section = {
    dataset: { githubUsername: username, githubSnapshotAt: snapshotAt },
    querySelector: (selector) => (selector === ".github-activity-list" ? list : updated),
  };
  let saved = cache;
  const storage = { getItem: () => saved, setItem: (_, value) => (saved = value) };
  return { section, list, updated, storage, saved: () => saved };
}

function mockDocument(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: element } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  });
}

test("failed, rate-limited, and empty API responses retain the static fallback", async () => {
  for (const fetcher of [
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: false, status: 429 }),
    async () => ({ ok: true, json: async () => [] }),
    async () => {
      throw new Error("offline");
    },
  ]) {
    const { section, list, updated, storage } = fixture("invalid cache JSON");
    await loadActivity(section, { fetcher, storage, now });
    assert.deepEqual(list.children, ["static fallback"]);
    assert.equal(updated.textContent, "Static update date");
  }
});

test("renders fresh API data safely and caches only normalized public fields", async (t) => {
  mockDocument(t);
  const ui = fixture(null);
  const title = "<script>doNotRun()</script>";
  const fetcher = async (url, options) => {
    assert.equal(url, `https://api.github.com/users/${username}/events/public?per_page=100`);
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => [event("IssuesEvent", { action: "opened", issue: { number: 7, title, body: "Do not cache bodies" } })] };
  };
  await loadActivity(ui.section, { fetcher, storage: ui.storage, now });
  const link = ui.list.children[0].children[1].children[0];
  assert.equal(link.textContent, `Opened issue #7: ${title}`);
  assert.equal(link.href, `https://github.com/${repo}/issues/7`);
  assert.equal(ui.updated.textContent, "Updated Nov 12, 2026.");
  assert.ok(!ui.saved().includes("Do not cache bodies"));
});

test("fresh cache avoids requests; expired cache remains usable if offline", async (t) => {
  mockDocument(t);
  const entries = normalizeEvents([event("PullRequestEvent", { action: "merged", number: 1373 })], username);
  for (const age of [60_000, 16 * 60_000]) {
    const ui = fixture(JSON.stringify({ fetchedAt: now - age, entries }));
    let requests = 0;
    await loadActivity(ui.section, {
      now,
      storage: ui.storage,
      fetcher: async () => {
        requests++;
        throw new Error("offline");
      },
    });
    assert.equal(requests, age < 15 * 60_000 ? 0 : 1);
    assert.equal(ui.list.children[0].children[1].children[0].textContent, "Merged pull request #1373");
  }
});

test("older or invalid caches cannot replace a newer static snapshot", async () => {
  const entries = normalizeEvents([event("PullRequestEvent", { action: "opened", number: 7 })], username);
  for (const cached of [
    { fetchedAt: now - 24 * 60 * 60_000, entries },
    { fetchedAt: now, entries: [{ ...entries[0], url: "javascript:alert(1)" }] },
  ]) {
    const ui = fixture(JSON.stringify(cached));
    await loadActivity(ui.section, { now, storage: ui.storage, fetcher: async () => ({ ok: false }) });
    assert.deepEqual(ui.list.children, ["static fallback"]);
  }
});

test("blocked browser storage does not prevent a fresh API response", async (t) => {
  mockDocument(t);
  const ui = fixture(null);
  const storage = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
  };
  await loadActivity(ui.section, {
    now,
    storage,
    fetcher: async () => ({ ok: true, json: async () => [event("PullRequestEvent", { action: "merged", number: 1373 })] }),
  });
  assert.equal(ui.list.children[0].children[1].children[0].textContent, "Merged pull request #1373");
});
