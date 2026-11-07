import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
type DashboardServices = {
  state(): unknown;
  rules(): unknown;
  saveRules(next: unknown): unknown;
  dispatch(type: string, args: any[]): unknown;
  why(id: number): unknown;
};

const JSON_HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const SESSION = "agent_autoloop_dashboard";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: JSON_HEADERS });

const EVENT_CATALOG = [
  [
    "issues.opened",
    "GitHub 新建 issue",
    "有人在 GitHub 仓库提交了新的 issue。",
    "处理新 issue、分类、补充信息或创建修复任务。",
  ],
  [
    "pull_request.labeled",
    "GitHub PR 加标签",
    "Pull request 被添加标签时产生。",
    "例如标签变为 ready-for-review 后启动检查。",
  ],
  ["issues.labeled", "GitHub issue 加标签", "Issue 被添加标签时产生。", "例如标记为 bug 后交给排查 Agent。"],
  ["issue_comment.created", "GitHub 新评论", "Issue 或 PR 收到新评论时产生。", "用来跟进评论中的新请求。"],
  ["feedback.new", "新反馈", "反馈来源提交了一条新的反馈。", "首次收到客户反馈时创建处理事项。"],
  ["feedback.followup", "反馈补充", "同一条反馈有新的补充内容。", "继续处理已有反馈，不重复创建事项。"],
  [
    "alert.*",
    "告警事件（前缀）",
    "运维来源发出 alert. 开头的告警。",
    "用前缀匹配接住 alert.error、alert.warning 等类型。",
  ],
  ["site.down", "站点不可用", "健康检查发现站点异常。", "让 Agent 核对原因并生成处理建议。"],
  ["site.recovered", "站点恢复", "健康检查重新通过。", "让 Agent 核对告警是否可以结案。"],
  ["brief.ready", "资料准备完成", "资料收集脚本完成并发出可处理事件。", "触发周报、简报或摘要任务。"],
  ["browser.verify", "浏览器核验请求", "外部浏览器任务请求人工或 Agent 核验。", "触发一个需要打开网页检查的任务。"],
  [
    "try.*",
    "自定义试验事件",
    "示例事件类型，只有你的来源实际发送时才会触发。",
    "用于本机先验证一条规则；可以替换成自己的类型。",
  ],
];

function dashboardCatalog(value: any) {
  const present = new Set<string>();
  for (const rule of value?.rules ?? []) {
    for (const type of rule.when?.types ?? []) present.add(type);
    for (const type of rule.emits?.types ?? []) present.add(type);
  }
  const events = [
    ...EVENT_CATALOG,
    ...[...present]
      .filter((type) => !EVENT_CATALOG.some((entry) => entry[0] === type))
      .map((type) => [
        type,
        "当前配置的自定义事件",
        "这个事件类型来自当前规则或回执许可。",
        "请到产生事件的插件或脚本中确认它何时发送。",
      ]),
  ].map(([type, name, when, use]) => ({ type, name, when, use }));
  const home = homedir();
  const skillRoots = [
    join(home, ".codex", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".agent-autoloop", "app", "skills"),
  ];
  const skills = skillRoots.flatMap((root) => {
    if (!existsSync(root)) return [];
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
        .map((entry) => {
          const file = join(root, entry.name, "SKILL.md");
          const text = readFileSync(file, "utf8");
          const description = text.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? "本机已安装的 Skill";
          return { name: entry.name, description, path: file };
        });
    } catch {
      return [];
    }
  });
  const uniqueSkills = [...new Map(skills.map((skill) => [skill.name, skill])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const pluginRoots = [join(home, ".agent-autoloop", "plugins"), join(import.meta.dirname, "..", "plugins")];
  const plugins = [
    ...new Set(
      pluginRoots.flatMap((root) => {
        try {
          return readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        } catch {
          return [];
        }
      }),
    ),
  ].map((name) => ({
    name,
    kinds: ["agent", "channel", "source"].filter((kind) =>
      pluginRoots.some((root) => existsSync(join(root, name, `${kind}.ts`))),
    ),
  }));
  const directoryCandidates = [
    home,
    join(home, "project"),
    join(home, "Documents"),
    join(home, "Desktop"),
    join(home, ".agent-autoloop", "try"),
    process.cwd(),
  ];
  const directories = [
    ...new Set(
      directoryCandidates.filter((directory) => {
        try {
          return statSync(directory).isDirectory();
        } catch {
          return false;
        }
      }),
    ),
  ].map((directory) =>
    directory === home ? "~/" : directory.startsWith(`${home}/`) ? `~/${directory.slice(home.length + 1)}` : directory,
  );
  return {
    enums: { tell: ["needed", "always", "never"], access: ["read", "edit", "full"] },
    fields: [
      {
        name: "parallel",
        label: "并发数",
        description: "按事件对象拆分事项时，最多同时运行多少轮；不填写表示整条规则串行。",
        example: "3",
      },
      {
        name: "resume",
        label: "接续会话",
        description: "同一事项尽量接着上一轮 Agent 会话继续，适合持续跟进的任务。",
        example: "开启",
      },
      { name: "group", label: "并发组", description: "同一组共享并发限制；不填写时默认使用规则名称。", example: "ops" },
      {
        name: "tell",
        label: "通知策略",
        description: "always 每轮完成都通知，needed 只有需要你处理时通知，never 压住 Agent 回执通知。",
        example: "needed",
      },
    ],
    events,
    sources: Object.entries(value?.sources ?? {})
      .filter(([id]) => id !== "schedule")
      .map(([id, source]: any) => ({
        id,
        name: source.name,
        adapter: source.adapter ?? null,
        endpoint: source.adapter ? `/v1/in/${id}` : "/v1/events",
      })),
    agents: Object.entries(value?.agents ?? {}).map(([id, agent]: any) => ({
      id,
      name: agent.name,
      use: agent.use,
      access: agent.access ?? "edit",
    })),
    channels: Object.entries(value?.channels ?? {}).map(([id, channel]: any) => ({
      id,
      name: channel.name,
      links: channel.links === true,
      answerers: channel.answerers?.length ?? 0,
    })),
    plugins,
    skills: uniqueSkills,
    directories,
  };
}

function cookie(request: Request) {
  const value = request.headers.get("cookie") ?? "";
  return value
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === SESSION)?.[1];
}

async function body(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 1024 * 1024) throw new Error("请求最多 1024 KB");
  const text = await request.text();
  if (text.length > 1024 * 1024) throw new Error("请求最多 1024 KB");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("请求不是 JSON");
  }
}

function chooseDirectory() {
  if (process.platform !== "darwin") throw new Error("当前系统没有可调用的原生目录选择器，请手动填写工作目录");
  return new Promise<string>((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-e", 'POSIX path of (choose folder with prompt "选择 Agent 工作目录")'],
      { timeout: 120_000 },
      (error, stdout) => {
        if (error) return reject(new Error(error.code === 1 ? "已取消选择目录" : `目录选择器失败：${error.message}`));
        const directory = stdout.trim();
        if (!directory) return reject(new Error("没有选择目录"));
        resolve(directory);
      },
    );
  });
}

function page() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Autoloop 本地控制台</title>
<style>
:root{color-scheme:light;--ink:#1b1d1f;--muted:#70757a;--paper:#f5f3ee;--panel:#fff;--line:#e4e0d8;--accent:#d86f43;--green:#27765b;--red:#b44838;--shadow:0 12px 28px #27231c12}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
button,input,textarea,select{font:inherit}button{cursor:pointer;border:0}.shell{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:100vh}
aside{background:#222629;color:#f7f5ef;padding:26px 18px;display:flex;flex-direction:column;gap:28px} .brand{font-size:18px;font-weight:750;letter-spacing:.01em}.brand small{display:block;color:#aeb4b4;font-size:11px;font-weight:500;margin-top:3px}
nav{display:grid;gap:5px}nav button{background:transparent;color:#bdc4c2;text-align:left;padding:10px 12px;border-radius:7px}nav button:hover,nav button.active{background:#363b3d;color:#fff} .side-note{margin-top:auto;color:#8c9591;font-size:12px}
main{max-width:1260px;width:100%;padding:32px 38px 54px;margin:0 auto}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:26px}.eyebrow{color:var(--accent);font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.top h1{margin:5px 0 0;font-size:29px;line-height:1.2;letter-spacing:-.02em}.status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px}.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px #27765b1c}
.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:28px}.stat,.panel,.rule{background:var(--panel);border:1px solid var(--line);border-radius:7px;box-shadow:var(--shadow)}.stat{padding:17px 18px}.stat label{display:block;color:var(--muted);font-size:12px}.stat strong{display:block;font-size:27px;margin-top:3px}.stat.warn strong{color:var(--red)}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:26px 0 12px}.section-head h2{font-size:17px;margin:0}.section-head p{color:var(--muted);font-size:13px;margin:3px 0 0}.primary,.secondary,.danger{border-radius:5px;padding:9px 13px;font-weight:700}.primary{background:var(--accent);color:#fff}.secondary{background:#efede8;color:var(--ink)}.danger{background:#f9e9e5;color:var(--red)}
.grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:16px}.panel{padding:18px}.empty{color:var(--muted);padding:24px 4px}.card{border-top:1px solid var(--line);padding:14px 0}.card:first-child{border-top:0;padding-top:0}.card-title{font-weight:750}.meta{color:var(--muted);font-size:12px;margin-top:2px}.card-text{margin:8px 0;color:#464b4d}.actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.choice{background:#f0eee8;color:var(--ink);padding:7px 10px;border-radius:5px}.choice:hover{background:#e3dfd5}.run{display:grid;grid-template-columns:1fr auto;gap:6px 15px;border-top:1px solid var(--line);padding:12px 0}.run:first-child{border-top:0;padding-top:0}.badge{display:inline-flex;align-items:center;border-radius:99px;padding:2px 8px;background:#edf2ef;color:var(--green);font-size:11px}.badge.running{background:#fff1e8;color:#b3562f}.badge.failed{background:#f9e9e5;color:var(--red)}
.rule-list{display:grid;gap:10px}.rule{padding:16px 18px;display:grid;grid-template-columns:1fr auto;gap:10px}.rule h3{font-size:15px;margin:0}.rule p{color:var(--muted);font-size:12px;margin:4px 0 0}.rule-actions{display:flex;gap:6px;align-items:start}.view{display:none}.view.active{display:block}
.form{display:grid;gap:12px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:grid;gap:5px}.field label{font-size:12px;font-weight:700}.field input,.field textarea,.field select{width:100%;border:1px solid var(--line);border-radius:5px;padding:9px;background:#fff}.field textarea{min-height:92px;resize:vertical}.hint{color:var(--muted);font-size:12px}.form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:5px}.field-help{font-size:12px;color:#555d5d;background:#f6f4ef;border-left:3px solid #d8d1c5;padding:7px 9px}.event-help{display:grid;gap:6px}.event-help strong{color:var(--ink)}.event-example{color:var(--green)}.config-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-items:start}.config-card{border:1px solid var(--line);border-radius:5px;padding:11px;background:#fcfbf8;align-self:start}.config-card h4{margin:0 0 5px;font-size:13px}.config-card p{margin:2px 0;color:var(--muted);font-size:12px}.config-manager{margin:12px 0;border:1px solid var(--line);border-radius:7px;background:var(--panel);box-shadow:var(--shadow)}.config-manager summary{cursor:pointer;padding:15px 18px;font-weight:750;list-style-position:inside}.config-manager summary::marker{color:var(--accent)}.config-manager[open] summary{border-bottom:1px solid var(--line)}.config-manager-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:0 12px 12px;align-items:start}.advanced-options{margin-top:2px;border-top:1px solid var(--line);padding-top:12px}.advanced-options summary{cursor:pointer;font-weight:700;color:#4d5353}.advanced-options[open] summary{margin-bottom:12px}
@media(max-width:860px){.shell{display:block}aside{position:static;padding:16px 18px;gap:15px}nav{display:flex;overflow:auto}nav button{white-space:nowrap}.side-note{display:none}main{padding:24px 18px}.summary{grid-template-columns:repeat(2,1fr)}.grid,.config-manager-grid{grid-template-columns:1fr}}
@media(max-width:520px){.top{display:block}.status{margin-top:14px}.summary{gap:8px}.stat{padding:13px}.stat strong{font-size:23px}.form-grid{grid-template-columns:1fr}}
</style></head><body><div class="shell"><aside><div class="brand">Agent Autoloop<small>本地控制台</small></div><nav>
<button class="active" data-nav="home">概览</button><button data-nav="rules">规则</button><button data-nav="runs">运行记录</button><button data-nav="help">使用说明</button>
</nav><div class="side-note">数据只保存在本机<br>服务地址 127.0.0.1</div></aside><main>
<header class="top"><div><div class="eyebrow">Local control room</div><h1 id="title">现在发生了什么</h1></div><div class="status"><span class="dot"></span><span id="service">中台在线</span><span id="updated"></span></div></header>
<section class="view active" id="home"><div class="summary"><div class="stat warn"><label>需要你处理</label><strong id="attention">加载中</strong></div><div class="stat"><label>正在运行</label><strong id="running">加载中</strong></div><div class="stat"><label>排队中</label><strong id="queued">加载中</strong></div><div class="stat"><label>今天完成</label><strong id="done">加载中</strong></div></div>
<div class="grid"><div><div class="section-head"><div><h2>需要你处理</h2><p>Agent 停在这里，等你的决定。</p></div></div><div class="panel" id="cards"></div></div><div><div class="section-head"><div><h2>正在运行</h2><p>最近的任务和进展。</p></div></div><div class="panel" id="active-runs"></div></div></div>
<div class="section-head"><div><h2>最近完成</h2><p>最后 20 条运行记录。</p></div></div><div class="panel" id="recent-runs"></div></section>
<section class="view" id="rules"><div class="section-head"><div><h2>规则</h2><p>决定什么事情交给哪个 Agent，在什么目录里完成。</p></div><button class="primary" id="new-rule">新建规则</button></div><div class="panel" style="margin-bottom:14px"><h3 style="margin:0 0 8px">当前可用对象</h3><div class="config-grid" id="config-summary"></div></div><div class="rule-list" id="rule-list"></div><div class="panel" id="rule-editor" style="display:none;margin-top:14px"><form class="form"><div class="section-head" style="margin:0"><div><h2 id="editor-title">新建规则</h2><p>保存前会自动校验，已经领取的任务不会被改写。</p></div></div><div class="form-grid"><div class="field"><label>规则名称</label><input id="f-name" required placeholder="例如：每日早报"><span class="hint">给人看的稳定名称，后续查运行记录也靠它识别。</span></div><div class="field"><label>交给 Agent</label><select id="f-to"></select><span class="hint">只能选择当前已登记的 Agent。要增加 Agent，需要在 agents 配置中登记新的执行器。</span></div><div class="field"><label>触发方式</label><select id="f-trigger"><option value="cron">定时</option><option value="event">事件</option></select></div><div class="field" id="f-cron-wrap"><label>Cron 表达式</label><input id="f-cron" placeholder="0 9 * * *"><span class="hint">5 段格式，例如每天 09:00；电脑休眠错过时只补最近一次。</span></div><div class="field" id="f-source-wrap"><label>事件来源</label><select id="f-source"></select><span class="hint">来源是“谁把事件送进中台”。它可以是 GitHub、轮询脚本或本机来源，不是事件类型。</span></div><div class="field" id="f-types-wrap"><label>事件类型</label><div style="display:grid;grid-template-columns:1fr 1.4fr;gap:6px"><select id="f-type-preset"><option value="">选择已知类型</option></select><input id="f-types" list="event-types" placeholder="也可以输入自定义类型，多个用逗号分隔"></div><datalist id="event-types"></datalist><div class="field-help event-help" id="event-help">现在可以直接从左侧下拉选择已知类型，也可以在右侧输入自定义类型。</div><span class="hint">类型由来源发送，必须符合小写字母开头、只能含小写字母/数字/下划线/点/短横线，最长 64 个字符；可以写精确值、x.* 前缀或 *。</span></div><div class="field"><label>工作目录</label><div style="display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:6px"><select id="f-cwd-select"><option value="">选择常用目录</option></select><button type="button" class="secondary" id="choose-cwd">打开系统选择器</button><input id="f-cwd" required placeholder="~/notes"></div><span class="hint">系统选择器会打开本机目录对话框；也可以手动填写路径。</span></div><div class="field"><label>Skill（可选）</label><input id="f-skill" list="skill-names" placeholder="搜索或输入 Skill 名称"><datalist id="skill-names"></datalist><div class="field-help" id="skill-help">Skill 是给 Agent 的工作方法。候选来自本机已安装的 SKILL.md，输入框支持搜索；留空表示只使用任务说明。</div></div><div class="field"><label>通知策略</label><select id="f-tell"><option value="needed">需要处理时通知</option><option value="always">每轮完成都通知</option><option value="never">不通知 Agent 回执</option></select><span class="hint">提问和中台告警仍会通知。</span></div><div class="field"><label>并发组</label><input id="f-group" placeholder="例如：ops"><div class="field-help">并发组是规则之间共享并发上限的名字。相同组名的规则会一起受限制；只配置一条规则时默认用规则名，通常可以留空。</div></div><div class="field"><label>并发数</label><input id="f-parallel" type="number" min="1" step="1" placeholder="例如：3"><span class="hint">按事件对象拆分事项时的最大同时轮数，留空表示串行。</span></div><label class="field" style="display:flex;align-items:center;gap:8px"><span><input id="f-resume" type="checkbox" style="width:auto"> 接续同一事项的 Agent 会话</span><span class="hint">适合持续跟进的事项，会节省重新解释上下文的成本。</span></label></div><div class="field"><label>任务说明</label><textarea id="f-prompt" placeholder="例如：读取 issue 内容，判断是否需要补充信息，并在工作目录创建修复计划"></textarea><span class="hint">这是给 Agent 的指令；外部事件标题和正文只作为资料传入，不会改变交给谁、在哪执行。</span></div><div class="field"><label>回执事件来源（可选）</label><select id="f-emits-source"></select><label>回执事件类型</label><input id="f-emits-types" list="event-types" placeholder="例如：pull_request.labeled"><div class="field-help">回执事件是 Agent 完成后主动发给中台的“下一件事”。它和触发事件不同：触发事件让规则开始，回执事件让后续规则继续。只能发送这里选择的来源和符合相同类型规则的类型，不能随意写任意字符。</div></div><div class="form-actions"><button type="button" class="secondary" id="cancel-rule">取消</button><button type="submit" class="primary">保存规则</button></div></form></div></section>
<section class="view" id="runs"><div class="section-head"><div><h2>运行记录</h2><p>每一轮任务的状态、结果和失败原因。</p></div></div><div class="panel" id="all-runs"></div></section>
<section class="view" id="help"><div class="section-head"><div><h2>怎么使用</h2><p>先看状态，再处理需要你决定的事情。</p></div></div><div class="panel"><h3>事件是什么</h3><p>事件是“外部发生了一件事”的标准记录，包含来源、编号、类型和资料。GitHub Webhook、轮询脚本、健康检查脚本都可以产生事件；看板不会凭空生成事件。</p><h3>事件类型怎么写</h3><p>类型是来源定义的字符串。写 <code>issues.opened</code> 只接新 issue，写 <code>feedback.*</code> 接住 feedback. 开头的所有类型，写 <code>*</code> 接住该来源的全部类型。下拉建议来自仓库内置示例，来源仍可以发送自定义类型。</p><h3>创建规则的最短流程</h3><p>进入“规则”，点击“新建规则”，先选择触发方式，再选择来源和 Agent，填写工作目录与任务说明。需要持续跟进时开启“接续会话”；需要限制并发时填写并发组和并发数。</p><h3>保存后的验证</h3><p>保存时会按真实规则协议校验：来源、Agent、通知策略等受限字段不能填不存在的值；规则不匹配任何事件时，事件仍会留在运行记录中，方便排查。</p><h3>什么时候需要 CLI</h3><p>命令行仍然可以用来做备份、密钥管理和脚本化操作。看板负责日常查看、回答和规则管理。</p></div></section>
</main></div><script>
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={};let rules={};let catalog={};let editing=null;
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'请求失败');return data}
function stateLabel(s){return ({queued:'排队中',claimed:'运行中',done:'完成',failed:'失败',nothing:'无事可做',cancelled:'已停止',unknown:'待确认'})[s]||s}
function renderCards(){const el=$('#cards');const cards=state.cards||[];if(!cards.length){el.innerHTML='<div class="empty">现在没有需要你处理的事情。</div>';return}el.innerHTML=cards.map(c=>\`<article class="card"><div class="card-title">\${esc(c.title)} <span class="badge">\${esc(c.kind==='ask'?'需要选择':'需要确认')}</span></div><div class="meta">#\${c.id} · \${esc(c.rule||'')}</div><div class="card-text">\${esc(c.text)}</div><div class="actions">\${(c.options||[]).map((o,i)=>\`<button class="choice" data-answer="\${c.id}" data-choice="\${i}">\${esc(o)}</button>\`).join('')}<button class="secondary" data-resolve="\${c.id}">暂不处理</button></div></article>\`).join('');el.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>answer(Number(b.dataset.answer),Number(b.dataset.choice)));el.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=()=>resolveCard(Number(b.dataset.resolve)))}
function runHtml(r){return \`<div class="run"><div><strong>#\${r.id} · \${esc(r.rule||'未命名')}</strong><div class="meta">\${esc(r.agent||'')} · \${esc(r.summary||r.error||'暂无结果')}</div></div><span class="badge \${r.state==='claimed'?'running':r.state==='failed'?'failed':''}">\${esc(stateLabel(r.state))}</span></div>\`}
function renderRuns(){const active=(state.runs||[]).filter(r=>['queued','claimed','unknown'].includes(r.state));const recent=(state.runs||[]).filter(r=>!active.includes(r));$('#active-runs').innerHTML=active.length?active.map(runHtml).join(''):'<div class="empty">没有正在运行的任务。</div>';$('#recent-runs').innerHTML=recent.length?recent.slice(0,8).map(runHtml).join(''):'<div class="empty">还没有运行记录。</div>';$('#all-runs').innerHTML=(state.runs||[]).length?state.runs.map(runHtml).join(''):'<div class="empty">还没有运行记录。</div>'}
function renderSummary(){const t=state.totals||{};$('#attention').textContent=t.attention??0;$('#running').textContent=t.running??0;$('#queued').textContent=t.queued??0;$('#done').textContent=t.doneToday??0;$('#updated').textContent=state.now?new Date(state.now).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):''}
function renderConfig(){const items=[['来源',catalog.sources||[],x=>x.name+'（'+x.id+'）→ '+x.endpoint],['Agent',catalog.agents||[],x=>x.name+'（'+x.id+'）'],['通道',catalog.channels||[],x=>x.name+'（'+x.id+'）'],['插件',catalog.plugins||[],x=>x.name+'：'+x.kinds.join('、')],['字段约束',catalog.fields||[],x=>x.label]];$('#config-summary').innerHTML=items.map(([title,list,format])=>'<div class="config-card"><h4>'+esc(title)+'</h4>'+(list.length?list.map(x=>'<p>'+esc(format(x))+'</p>').join(''):'<p>暂无</p>')+'</div>').join('');if(!$('#config-manager'))$('#config-summary').closest('.panel').insertAdjacentHTML('afterend',managerMarkup());renderConfigManager();if(!document.querySelector('#try-lifecycle'))$('#help .panel').insertAdjacentHTML('beforeend','<h3 id="try-lifecycle">try.start 的生命周期</h3><p>运行 agent-autoloop try 时，CLI 会向本机来源发送一条真实事件，type 是 try.start。规则里的 try.* 是前缀匹配，所以它会被接住；这不是内置魔法事件。随后规则把 prompt、工作目录和事件资料交给 Agent，Agent 可以发问，回答后继续同一事项，最后回执完成或失败。</p>')}
function managerMarkup(){return '<div id="config-manager" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:12px 0"><div class="panel"><h3>来源与 Webhook</h3><p class="hint">来源决定谁把事件送进中台。GitHub 地址按来源编号生成。</p><div id="source-list"></div><form id="source-form" class="mini-form"><input id="source-id" pattern="[a-z][a-z0-9-]*" placeholder="编号，例如 github" required><input id="source-name" placeholder="显示名称，例如 GitHub" required><input id="source-adapter" placeholder="适配器，例如 github"><button class="primary">保存来源</button></form><div class="field-help">GitHub：保存 github + github 后，Payload URL 使用 /v1/in/github；密钥是 AGENT_AUTOLOOP_SECRET_GITHUB。本机地址不能被 GitHub 直接访问。</div></div><div class="panel"><h3>Agent</h3><p class="hint">Agent 是实际执行任务的程序，use 要对应 Agent 插件。</p><div id="agent-list"></div><form id="agent-form" class="mini-form"><input id="agent-id" pattern="[a-z][a-z0-9-]*" placeholder="编号，例如 codex" required><input id="agent-name" placeholder="显示名称" required><input id="agent-worker" placeholder="工作进程名" required><input id="agent-use" placeholder="插件，例如 codex" required><select id="agent-access"><option value="read">只读</option><option value="edit" selected>可编辑工作目录</option><option value="full">完整权限</option></select><input id="agent-command" placeholder="command Agent 命令（可选）"><button class="primary">保存 Agent</button></form></div><div class="panel"><h3>通道</h3><p class="hint">通道负责发送问题卡片并接收回答。</p><div id="channel-list"></div><form id="channel-form" class="mini-form"><input id="channel-id" pattern="[a-z][a-z0-9-]*" placeholder="编号，例如 desktop" required><input id="channel-name" placeholder="显示名称" required><input id="channel-answerers" placeholder="回答人编号，逗号分隔"><label><input id="channel-links" type="checkbox"> 允许卡片链接</label><button class="primary">保存通道</button></form></div><div class="panel" style="grid-column:1/-1"><h3>插件</h3><p class="hint">插件是可执行代码：Agent 启动程序，Source 验签并翻译 Webhook，Channel 发送卡片。安装使用 agent-autoloop add &lt;Git 地址&gt;；删除前要确认没有配置正在使用。</p><div id="plugin-detail"></div></div></div>'}
function renderConfigManager(){const renderList=(id,entries,kind)=>{$('#'+id).innerHTML=Object.entries(entries||{}).filter(([key])=>key!=='schedule').map(([key,value])=>'<div style="display:flex;justify-content:space-between;gap:6px;border-top:1px solid var(--line);padding:6px 0;font-size:12px"><span><strong>'+esc(value.name||key)+'</strong><small style="display:block;color:var(--muted)">'+esc(key)+'</small></span><button type="button" class="danger" data-config-delete="'+esc(kind)+'" data-config-id="'+esc(key)+'">删除</button></div>').join('')||'<p class="hint">暂无</p>'};renderList('source-list',rules.sources,'source');renderList('agent-list',rules.agents,'agent');renderList('channel-list',rules.channels,'channel');$('#plugin-detail').innerHTML=(catalog.plugins||[]).map(p=>'<p class="hint"><strong>'+esc(p.name)+'</strong>：'+esc(p.kinds.join('、'))+'</p>').join('')||'<p class="hint">暂无</p>';document.querySelectorAll('[data-config-delete]').forEach(button=>button.onclick=()=>deleteConfig(button.dataset.configDelete,button.dataset.configId));$('#source-form').onsubmit=e=>{e.preventDefault();const id=$('#source-id').value.trim();saveConfig('source',id,{name:$('#source-name').value.trim(),...(($('#source-adapter').value.trim())?{adapter:$('#source-adapter').value.trim()}: {})})};$('#agent-form').onsubmit=e=>{e.preventDefault();const id=$('#agent-id').value.trim();const value={name:$('#agent-name').value.trim(),worker:$('#agent-worker').value.trim(),use:$('#agent-use').value.trim(),access:$('#agent-access').value};if($('#agent-command').value.trim())value.command=$('#agent-command').value.trim().split(/\\s+/);saveConfig('agent',id,value)};$('#channel-form').onsubmit=e=>{e.preventDefault();const id=$('#channel-id').value.trim();const answerers=$('#channel-answerers').value.split(',').map(x=>x.trim()).filter(Boolean);saveConfig('channel',id,{name:$('#channel-name').value.trim(),...(answerers.length?{answerers}:{}),links:$('#channel-links').checked})}}
function decorateConfig(){const summary=$('#config-summary');if(summary){const heading=summary.previousElementSibling;if(heading&&heading.tagName==='H3'){heading.textContent='配置概览';if(!heading.nextElementSibling||!heading.nextElementSibling.matches('.config-summary-hint')){const hint=document.createElement('p');hint.className='hint config-summary-hint';hint.style.margin='0 0 10px';hint.textContent='这些对象会出现在规则编辑器中。需要新增或修改时，展开下方配置管理。';heading.insertAdjacentElement('afterend',hint)}}const manager=$('#config-manager');if(manager&&!$('#config-manager-details')){manager.removeAttribute('style');manager.className='config-manager-grid';const details=document.createElement('details');details.id='config-manager-details';details.className='config-manager';const summaryEl=document.createElement('summary');summaryEl.textContent='配置管理：来源、Agent、通道和插件';details.append(summaryEl);manager.replaceWith(details);details.append(manager)}}}
const renderConfigManagerOriginal=renderConfigManager;renderConfigManager=()=>{renderConfigManagerOriginal();decorateConfig()};
async function saveConfig(kind,id,value){const copy=JSON.parse(JSON.stringify(rules));copy[kind+'s']??={};copy[kind+'s'][id]=value;try{rules=await api('/api/dashboard/rules',{method:'PUT',body:JSON.stringify(copy)});renderConfig();renderRules()}catch(err){alert(err.message)}}
async function deleteConfig(kind,id){if(!confirm('删除'+kind+'「'+id+'」？若仍被规则引用，保存会被拒绝。'))return;const copy=JSON.parse(JSON.stringify(rules));delete copy[kind+'s']?.[id];try{rules=await api('/api/dashboard/rules',{method:'PUT',body:JSON.stringify(copy)});renderConfig();renderRules()}catch(err){alert(err.message)}}
function renderRules(){const list=$('#rule-list');const rs=rules.rules||[];if(!rs.length){list.innerHTML='<div class="panel empty">还没有规则。先创建一条，让 Agent 有明确的工作入口。</div>';return}list.innerHTML=rs.map((r,i)=>{const when=r.when?.cron?\`每天按 \${esc(r.when.cron)} 触发\`:\`收到 \${esc(r.when?.source||'')} / \${esc((r.when?.types||[]).join(', '))} 时触发\`;const options=[r.tell?'通知：'+r.tell:'通知：needed',r.resume?'接续会话':'新会话',r.parallel?'并发 '+r.parallel:'串行'];return \`<article class="rule"><div><h3>\${esc(r.name)}</h3><p>\${when} · 交给 \${esc(r.to)} · \${esc(r.cwd)}</p><p>\${esc(options.join(' · '))}</p><p>\${esc(r.prompt||r.skill||'未填写任务说明')}</p></div><div class="rule-actions"><button class="secondary" data-edit="\${i}">编辑</button><button class="danger" data-delete="\${i}">删除</button></div></article>\`}).join('');list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(Number(b.dataset.edit)));list.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteRule(Number(b.dataset.delete)))}
function decorateEditor(){const form=$('#rule-editor form');const grid=form?.querySelector('.form-grid');if(!form||!grid||$('#advanced-options'))return;const details=document.createElement('details');details.id='advanced-options';details.className='advanced-options';const summary=document.createElement('summary');summary.textContent='高级选项（Skill、通知、并发、接续和回执）';details.append(summary);['#f-skill','#f-tell','#f-group','#f-parallel','#f-resume','#f-emits-source'].forEach(selector=>{const field=form.querySelector(selector)?.closest('.field');if(field)details.append(field)});const promptField=form.querySelector('#f-prompt')?.closest('.field');grid.insertAdjacentElement('afterend',details);if(promptField)details.insertAdjacentElement('beforebegin',promptField)}
const openEditorOriginal=openEditor;openEditor=(index)=>{openEditorOriginal(index);decorateEditor()};
function fillOptions(){const agents=Object.entries(rules.agents||{});$('#f-to').innerHTML=agents.map(([id,a])=>\`<option value="\${esc(id)}">\${esc(a.name||id)}（\${esc(id)}）</option>\`).join('');const sources=Object.entries(rules.sources||{}).filter(([id])=>id!=='schedule');const sourceHtml=sources.map(([id,s])=>\`<option value="\${esc(id)}">\${esc(s.name||id)}（\${esc(id)}）</option>\`).join('');$('#f-source').innerHTML=sourceHtml;$('#f-emits-source').innerHTML='<option value="">不发送回执事件</option>'+sourceHtml;const eventOptions=(catalog.events||[]).map(e=>\`<option value="\${esc(e.type)}">\${esc(e.name)}（\${esc(e.type)}）</option>\`).join('');$('#event-types').innerHTML=eventOptions;$('#f-type-preset').innerHTML='<option value="">选择已知类型</option>'+eventOptions;$('#skill-names').innerHTML=(catalog.skills||[]).map(s=>\`<option value="\${esc(s.name)}">\${esc(s.name)}：\${esc(s.description)}</option>\`).join('');$('#f-cwd-select').innerHTML='<option value="">选择本机目录</option>'+(catalog.directories||[]).map(directory=>\`<option value="\${esc(directory)}">\${esc(directory)}</option>\`).join('')}
function updateEventHelp(){const raw=$('#f-types').value.split(',').map(x=>x.trim()).filter(Boolean)[0];const event=(catalog.events||[]).find(e=>e.type===raw);$('#event-help').innerHTML=event?'<strong>'+esc(event.name)+'</strong><br>'+esc(event.when)+'<br><span class="event-example">用途：'+esc(event.use)+'</span>':'选择或填写事件类型后，这里会显示它的产生方式和用途。自定义类型请回到产生事件的插件或脚本确认。'}
function openEditor(index){editing=index;const r=index===null?{}:rules.rules[index];fillOptions();$('#editor-title').textContent=index===null?'新建规则':'编辑规则';$('#f-name').value=r.name||'';$('#f-to').value=r.to||Object.keys(rules.agents||{})[0]||'';$('#f-trigger').value=r.when?.cron?'cron':'event';$('#f-cron').value=r.when?.cron||'';$('#f-source').value=r.when?.source||Object.keys(rules.sources||{}).find(x=>x!=='schedule')||'';$('#f-types').value=(r.when?.types||[]).join(', ');$('#f-cwd').value=r.cwd||'~/';$('#f-cwd-select').value=r.cwd||'';$('#f-skill').value=r.skill||'';$('#f-prompt').value=r.prompt||'';$('#f-group').value=r.group||'';$('#f-parallel').value=r.parallel||'';$('#f-resume').checked=Boolean(r.resume);$('#f-tell').value=r.tell||'needed';$('#f-emits-source').value=r.emits?.source||'';$('#f-emits-types').value=(r.emits?.types||[]).join(', ');$('#rule-editor').style.display='block';toggleTrigger();updateEventHelp();window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})}
function toggleTrigger(){const cron=$('#f-trigger').value==='cron';$('#f-cron-wrap').style.display=cron?'grid':'none';$('#f-source-wrap').style.display=cron?'none':'grid';$('#f-types-wrap').style.display=cron?'none':'grid'}
async function saveRule(e){e.preventDefault();const cron=$('#f-trigger').value==='cron';const old=editing===null?{}:rules.rules[editing];const next={...old,name:$('#f-name').value.trim(),when:cron?{cron:$('#f-cron').value.trim()}:{source:$('#f-source').value,types:$('#f-types').value.split(',').map(x=>x.trim()).filter(Boolean)},to:$('#f-to').value,cwd:$('#f-cwd').value.trim(),prompt:$('#f-prompt').value.trim(),tell:$('#f-tell').value};if($('#f-skill').value.trim())next.skill=$('#f-skill').value.trim();else delete next.skill;if($('#f-group').value.trim())next.group=$('#f-group').value.trim();else delete next.group;if($('#f-parallel').value)next.parallel=Number($('#f-parallel').value);else delete next.parallel;if($('#f-resume').checked)next.resume=true;else delete next.resume;const emitsTypes=$('#f-emits-types').value.split(',').map(x=>x.trim()).filter(Boolean);if($('#f-emits-source').value&&emitsTypes.length)next.emits={source:$('#f-emits-source').value,types:emitsTypes};else delete next.emits;const copy=JSON.parse(JSON.stringify(rules));if(editing===null)copy.rules.push(next);else copy.rules[editing]=next;try{rules=await api('/api/dashboard/rules',{method:'PUT',body:JSON.stringify(copy)});$('#rule-editor').style.display='none';editing=null;renderRules();await refresh()}catch(err){alert(err.message)}}
async function deleteRule(index){if(!confirm('删除这条规则？已经领取的任务不会被改写。'))return;const copy=JSON.parse(JSON.stringify(rules));copy.rules.splice(index,1);try{rules=await api('/api/dashboard/rules',{method:'PUT',body:JSON.stringify(copy)});renderRules();await refresh()}catch(err){alert(err.message)}}
async function answer(id,choice){try{await api('/api/dashboard/cards/'+id+'/answer',{method:'POST',body:JSON.stringify({choice})});await refresh()}catch(err){alert(err.message)}}
async function resolveCard(id){const reason=prompt('写一句处理结果');if(!reason)return;try{await api('/api/dashboard/cards/'+id+'/resolve',{method:'POST',body:JSON.stringify({reason})});await refresh()}catch(err){alert(err.message)}}
async function refresh(){try{state=await api('/api/dashboard/state');renderSummary();renderCards();renderRuns()}catch(err){$('#service').textContent='服务连接失败';$('.dot').style.background='var(--red)'}}
async function loadRules(){try{[rules,catalog]=await Promise.all([api('/api/dashboard/rules'),api('/api/dashboard/catalog')]);renderConfig();renderRules()}catch(err){alert(err.message)}}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-nav]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===b.dataset.nav));$('#title').textContent=({home:'现在发生了什么',rules:'管理自动任务规则',runs:'运行记录',help:'使用说明'})[b.dataset.nav];if(b.dataset.nav==='rules')loadRules()});
$('#new-rule').onclick=()=>openEditor(null);$('#cancel-rule').onclick=()=>$('#rule-editor').style.display='none';$('#f-trigger').onchange=toggleTrigger;$('#f-types').oninput=updateEventHelp;$('#f-type-preset').onchange=()=>{const value=$('#f-type-preset').value;if(!value)return;const types=$('#f-types').value.split(',').map(x=>x.trim()).filter(Boolean);if(!types.includes(value))types.push(value);$('#f-types').value=types.join(', ');$('#f-type-preset').value='';updateEventHelp()};$('#f-cwd-select').onchange=()=>{if($('#f-cwd-select').value)$('#f-cwd').value=$('#f-cwd-select').value};$('#choose-cwd').onclick=async()=>{try{const result=await api('/api/dashboard/choose-directory',{method:'POST'});$('#f-cwd').value=result.directory;$('#f-cwd-select').value=''}catch(err){alert(err.message)}};document.querySelector('#rule-editor form').onsubmit=saveRule;refresh();loadRules();setInterval(refresh,5000);
</script></body></html>`;
}

export function createDashboardHandler(services: DashboardServices) {
  const session = randomBytes(24).toString("base64url");
  const authorized = (request: Request) => cookie(request) === session;
  return async function dashboard(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname === "/dashboard") return Response.redirect(new URL("/", request.url), 302);
    const api = url.pathname.startsWith("/api/dashboard/");
    if (url.pathname !== "/" && !api) return null;
    if (!api && request.method === "GET") {
      return new Response(page(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": `${SESSION}=${session}; HttpOnly; SameSite=Strict; Path=/`,
        },
      });
    }
    if (!authorized(request)) return json({ error: "看板会话已失效，请刷新页面" }, 401);
    try {
      if (request.method === "GET" && url.pathname === "/api/dashboard/state") return json(services.state());
      if (request.method === "GET" && url.pathname === "/api/dashboard/rules") return json(services.rules());
      if (request.method === "GET" && url.pathname === "/api/dashboard/catalog")
        return json(dashboardCatalog(services.rules()));
      if (request.method === "POST" && url.pathname === "/api/dashboard/choose-directory")
        return json({ directory: await chooseDirectory() });
      if (request.method === "PUT" && url.pathname === "/api/dashboard/rules")
        return json(services.saveRules(await body(request)));
      const card = /^\/api\/dashboard\/cards\/([1-9][0-9]*)\/(answer|resolve)$/.exec(url.pathname);
      if (request.method === "POST" && card) {
        const given = await body(request);
        if (card[2] === "answer") return json(services.dispatch("answer", [Number(card[1]), { ...given, by: "本人" }]));
        return json(services.dispatch("resolve", [Number(card[1]), String(given.reason ?? ""), "本人"]));
      }
      const run = /^\/api\/dashboard\/runs\/([1-9][0-9]*)\/why$/.exec(url.pathname);
      if (request.method === "GET" && run) return json(services.why(Number(run[1])));
      return json({ error: "没有这个地址" }, 404);
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
  };
}
