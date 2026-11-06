// The dashboard must expose a usable local entry point without leaking the owner API key.
import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardHandler } from "../host/dashboard.ts";

const rules = {
  timezone: "Asia/Shanghai",
  askFirst: ["删数据"],
  sources: { local: { name: "本机" } },
  agents: { codex: { name: "Codex", worker: "mac", use: "codex", access: "edit" } },
  channels: { desktop: { name: "桌面通知" } },
  rules: [
    {
      name: "试一下",
      when: { source: "local", types: ["try.*"] },
      to: "codex",
      cwd: "~/try",
      prompt: "跑一次试验",
      group: "试一下",
      tell: "needed",
    },
  ],
  elsewhere: [],
};

function setup() {
  let saved: unknown;
  const handler = createDashboardHandler({
    state: () => ({
      totals: { attention: 0, running: 0, queued: 0, doneToday: 0 },
      cards: [],
      recentCards: [],
      runs: [],
      agents: [],
      channels: [],
      lines: [],
    }),
    rules: () => rules,
    saveRules: (next) => {
      saved = next;
      return next;
    },
    dispatch: () => ({ changed: true }),
    why: () => [],
  });
  return {
    handler,
    get saved() {
      return saved;
    },
  };
}

test("dashboard serves a local page and protects its API with a session cookie", async () => {
  const { handler } = setup();
  const page = await handler(new Request("http://127.0.0.1:3350/"));
  assert.equal(page?.status, 200);
  const cookie = page?.headers.get("set-cookie");
  assert.match(cookie ?? "", /HttpOnly/);
  const state = await handler(new Request("http://127.0.0.1:3350/api/dashboard/state"));
  assert.equal(state?.status, 401);
  const authorized = await handler(
    new Request("http://127.0.0.1:3350/api/dashboard/state", { headers: { cookie: cookie! } }),
  );
  assert.equal(authorized?.status, 200);
});

test("dashboard saves rules through its service boundary", async () => {
  const context = setup();
  const { handler } = context;
  const page = await handler(new Request("http://127.0.0.1:3350/"));
  const cookie = page?.headers.get("set-cookie")!;
  const next = { ...rules, rules: [{ ...rules.rules[0], name: "新的规则" }] };
  const response = await handler(
    new Request("http://127.0.0.1:3350/api/dashboard/rules", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(next),
    }),
  );
  assert.equal(response?.status, 200);
  assert.equal((context.saved as any).rules[0].name, "新的规则");
});

test("dashboard exposes rule catalog with event explanations and constrained choices", async () => {
  const { handler } = setup();
  const page = await handler(new Request("http://127.0.0.1:3350/"));
  const cookie = page?.headers.get("set-cookie")!;
  const response = await handler(new Request("http://127.0.0.1:3350/api/dashboard/catalog", { headers: { cookie } }));
  assert.equal(response?.status, 200);
  const catalog = await response!.json();
  assert.deepEqual(catalog.enums.tell, ["needed", "always", "never"]);
  assert.ok(catalog.events.some((event: any) => event.type === "issues.opened"));
  assert.ok(catalog.events.some((event: any) => event.type === "try.*"));
  assert.ok(catalog.fields.some((field: any) => field.name === "parallel"));
  assert.ok(Array.isArray(catalog.skills));
  assert.ok(Array.isArray(catalog.directories));
  assert.ok(catalog.channels.some((channel: any) => channel.id === "desktop"));
  assert.ok(catalog.plugins.some((plugin: any) => plugin.name === "codex" && plugin.kinds.includes("agent")));
});

test("dashboard rule edits preserve advanced routing fields", async () => {
  const context = setup();
  const page = await context.handler(new Request("http://127.0.0.1:3350/"));
  const cookie = page?.headers.get("set-cookie")!;
  const next = {
    ...rules,
    rules: [
      {
        ...rules.rules[0],
        tell: "always",
        resume: true,
        parallel: 2,
        emits: { source: "local", types: ["feedback.new"] },
      },
    ],
  };
  const response = await context.handler(
    new Request("http://127.0.0.1:3350/api/dashboard/rules", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(next),
    }),
  );
  assert.equal(response?.status, 200);
  assert.equal((context.saved as any).rules[0].tell, "always");
  assert.equal((context.saved as any).rules[0].resume, true);
  assert.equal((context.saved as any).rules[0].parallel, 2);
  assert.deepEqual((context.saved as any).rules[0].emits, next.rules[0].emits);
});
