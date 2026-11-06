import { randomBytes } from "node:crypto";

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
.form{display:grid;gap:12px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:grid;gap:5px}.field label{font-size:12px;font-weight:700}.field input,.field textarea,.field select{width:100%;border:1px solid var(--line);border-radius:5px;padding:9px;background:#fff}.field textarea{min-height:92px;resize:vertical}.hint{color:var(--muted);font-size:12px}.form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:5px}
@media(max-width:860px){.shell{display:block}aside{position:static;padding:16px 18px;gap:15px}nav{display:flex;overflow:auto}nav button{white-space:nowrap}.side-note{display:none}main{padding:24px 18px}.summary{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}
@media(max-width:520px){.top{display:block}.status{margin-top:14px}.summary{gap:8px}.stat{padding:13px}.stat strong{font-size:23px}.form-grid{grid-template-columns:1fr}}
</style></head><body><div class="shell"><aside><div class="brand">Agent Autoloop<small>本地控制台</small></div><nav>
<button class="active" data-nav="home">概览</button><button data-nav="rules">规则</button><button data-nav="runs">运行记录</button><button data-nav="help">使用说明</button>
</nav><div class="side-note">数据只保存在本机<br>服务地址 127.0.0.1</div></aside><main>
<header class="top"><div><div class="eyebrow">Local control room</div><h1 id="title">现在发生了什么</h1></div><div class="status"><span class="dot"></span><span id="service">中台在线</span><span id="updated"></span></div></header>
<section class="view active" id="home"><div class="summary"><div class="stat warn"><label>需要你处理</label><strong id="attention">-</strong></div><div class="stat"><label>正在运行</label><strong id="running">-</strong></div><div class="stat"><label>排队中</label><strong id="queued">-</strong></div><div class="stat"><label>今天完成</label><strong id="done">-</strong></div></div>
<div class="grid"><div><div class="section-head"><div><h2>需要你处理</h2><p>Agent 停在这里，等你的决定。</p></div></div><div class="panel" id="cards"></div></div><div><div class="section-head"><div><h2>正在运行</h2><p>最近的任务和进展。</p></div></div><div class="panel" id="active-runs"></div></div></div>
<div class="section-head"><div><h2>最近完成</h2><p>最后 20 条运行记录。</p></div></div><div class="panel" id="recent-runs"></div></section>
<section class="view" id="rules"><div class="section-head"><div><h2>规则</h2><p>决定什么事情交给哪个 Agent，在什么目录里完成。</p></div><button class="primary" id="new-rule">新建规则</button></div><div class="rule-list" id="rule-list"></div><div class="panel" id="rule-editor" style="display:none;margin-top:14px"><form class="form"><div class="section-head" style="margin:0"><div><h2 id="editor-title">新建规则</h2><p>保存前会自动校验，已经领取的任务不会被改写。</p></div></div><div class="form-grid"><div class="field"><label>规则名称</label><input id="f-name" required placeholder="例如：每日早报"></div><div class="field"><label>交给 Agent</label><select id="f-to"></select></div><div class="field"><label>触发方式</label><select id="f-trigger"><option value="cron">定时</option><option value="event">事件</option></select></div><div class="field" id="f-cron-wrap"><label>Cron 表达式</label><input id="f-cron" placeholder="0 9 * * *"></div><div class="field" id="f-source-wrap"><label>事件来源</label><select id="f-source"></select></div><div class="field" id="f-types-wrap"><label>事件类型</label><input id="f-types" placeholder="issues.opened, feedback.*"></div><div class="field"><label>工作目录</label><input id="f-cwd" required placeholder="~/notes"></div><div class="field"><label>Skill（可选）</label><input id="f-skill" placeholder=""></div></div><div class="field"><label>任务说明</label><textarea id="f-prompt" placeholder="告诉 Agent 要完成什么"></textarea><span class="hint">规则里的说明是指令；外部事件的标题和正文只会作为资料传入。</span></div><div class="form-actions"><button type="button" class="secondary" id="cancel-rule">取消</button><button type="submit" class="primary">保存规则</button></div></form></div></section>
<section class="view" id="runs"><div class="section-head"><div><h2>运行记录</h2><p>每一轮任务的状态、结果和失败原因。</p></div></div><div class="panel" id="all-runs"></div></section>
<section class="view" id="help"><div class="section-head"><div><h2>怎么使用</h2><p>先看状态，再处理需要你决定的事情。</p></div></div><div class="panel"><h3>日常流程</h3><p>打开概览，处理“需要你处理”的卡片；运行中的任务会自动刷新，完成后可在运行记录里查看。</p><h3>创建自动任务</h3><p>进入“规则”，点击“新建规则”，选择定时或事件触发，填写 Agent、工作目录和任务说明，然后保存。</p><h3>什么时候需要 CLI</h3><p>命令行仍然可以用来做备份、密钥管理和脚本化操作。看板负责日常查看、回答和规则管理。</p></div></section>
</main></div><script>
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={};let rules={};let editing=null;
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'请求失败');return data}
function stateLabel(s){return ({queued:'排队中',claimed:'运行中',done:'完成',failed:'失败',nothing:'无事可做',cancelled:'已停止',unknown:'待确认'})[s]||s}
function renderCards(){const el=$('#cards');const cards=state.cards||[];if(!cards.length){el.innerHTML='<div class="empty">现在没有需要你处理的事情。</div>';return}el.innerHTML=cards.map(c=>\`<article class="card"><div class="card-title">\${esc(c.title)} <span class="badge">\${esc(c.kind==='ask'?'需要选择':'需要确认')}</span></div><div class="meta">#\${c.id} · \${esc(c.rule||'')}</div><div class="card-text">\${esc(c.text)}</div><div class="actions">\${(c.options||[]).map((o,i)=>\`<button class="choice" data-answer="\${c.id}" data-choice="\${i}">\${esc(o)}</button>\`).join('')}<button class="secondary" data-resolve="\${c.id}">暂不处理</button></div></article>\`).join('');el.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>answer(Number(b.dataset.answer),Number(b.dataset.choice)));el.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=()=>resolveCard(Number(b.dataset.resolve)))}
function runHtml(r){return \`<div class="run"><div><strong>#\${r.id} · \${esc(r.rule||'未命名')}</strong><div class="meta">\${esc(r.agent||'')} · \${esc(r.summary||r.error||'暂无结果')}</div></div><span class="badge \${r.state==='claimed'?'running':r.state==='failed'?'failed':''}">\${esc(stateLabel(r.state))}</span></div>\`}
function renderRuns(){const active=(state.runs||[]).filter(r=>['queued','claimed','unknown'].includes(r.state));const recent=(state.runs||[]).filter(r=>!active.includes(r));$('#active-runs').innerHTML=active.length?active.map(runHtml).join(''):'<div class="empty">没有正在运行的任务。</div>';$('#recent-runs').innerHTML=recent.length?recent.slice(0,8).map(runHtml).join(''):'<div class="empty">还没有运行记录。</div>';$('#all-runs').innerHTML=(state.runs||[]).length?state.runs.map(runHtml).join(''):'<div class="empty">还没有运行记录。</div>'}
function renderSummary(){const t=state.totals||{};$('#attention').textContent=t.attention??0;$('#running').textContent=t.running??0;$('#queued').textContent=t.queued??0;$('#done').textContent=t.doneToday??0;$('#updated').textContent=state.now?new Date(state.now).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):''}
function renderRules(){const list=$('#rule-list');const rs=rules.rules||[];if(!rs.length){list.innerHTML='<div class="panel empty">还没有规则。先创建一条，让 Agent 有明确的工作入口。</div>';return}list.innerHTML=rs.map((r,i)=>{const when=r.when?.cron?\`每天按 \${esc(r.when.cron)} 触发\`:\`收到 \${esc(r.when?.source||'')} / \${esc((r.when?.types||[]).join(', '))} 时触发\`;return \`<article class="rule"><div><h3>\${esc(r.name)}</h3><p>\${when} · 交给 \${esc(r.to)} · \${esc(r.cwd)}</p><p>\${esc(r.prompt||r.skill||'未填写任务说明')}</p></div><div class="rule-actions"><button class="secondary" data-edit="\${i}">编辑</button><button class="danger" data-delete="\${i}">删除</button></div></article>\`}).join('');list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(Number(b.dataset.edit)));list.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteRule(Number(b.dataset.delete)))}
function fillOptions(){const agents=Object.entries(rules.agents||{});$('#f-to').innerHTML=agents.map(([id,a])=>\`<option value="\${esc(id)}">\${esc(a.name||id)}</option>\`).join('');const sources=Object.entries(rules.sources||{}).filter(([id])=>id!=='schedule');$('#f-source').innerHTML=sources.map(([id,s])=>\`<option value="\${esc(id)}">\${esc(s.name||id)}</option>\`).join('')}
function openEditor(index){editing=index;const r=index===null?{}:rules.rules[index];fillOptions();$('#editor-title').textContent=index===null?'新建规则':'编辑规则';$('#f-name').value=r.name||'';$('#f-to').value=r.to||Object.keys(rules.agents||{})[0]||'';$('#f-trigger').value=r.when?.cron?'cron':'event';$('#f-cron').value=r.when?.cron||'';$('#f-source').value=r.when?.source||Object.keys(rules.sources||{}).find(x=>x!=='schedule')||'';$('#f-types').value=(r.when?.types||[]).join(', ');$('#f-cwd').value=r.cwd||'~/';$('#f-skill').value=r.skill||'';$('#f-prompt').value=r.prompt||'';$('#rule-editor').style.display='block';toggleTrigger();window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})}
function toggleTrigger(){const cron=$('#f-trigger').value==='cron';$('#f-cron-wrap').style.display=cron?'grid':'none';$('#f-source-wrap').style.display=cron?'none':'grid';$('#f-types-wrap').style.display=cron?'none':'grid'}
async function saveRule(e){e.preventDefault();const cron=$('#f-trigger').value==='cron';const old=editing===null?{}:rules.rules[editing];const next={...old,name:$('#f-name').value.trim(),when:cron?{cron:$('#f-cron').value.trim()}:{source:$('#f-source').value,types:$('#f-types').value.split(',').map(x=>x.trim()).filter(Boolean)},to:$('#f-to').value,cwd:$('#f-cwd').value.trim(),prompt:$('#f-prompt').value.trim()};if($('#f-skill').value.trim())next.skill=$('#f-skill').value.trim();else delete next.skill;delete next.group;delete next.tell;const copy=JSON.parse(JSON.stringify(rules));if(editing===null)copy.rules.push(next);else copy.rules[editing]=next;try{rules=await api('/api/dashboard/rules',{method:'PUT',body:JSON.stringify(copy)});$('#rule-editor').style.display='none';editing=null;renderRules();await refresh()}catch(err){alert(err.message)}}
async function deleteRule(index){if(!confirm('删除这条规则？已经领取的任务不会被改写。'))return;const copy=JSON.parse(JSON.stringify(rules));copy.rules.splice(index,1);try{rules=await api('/api/dashboard/rules',{method:'PUT',body:JSON.stringify(copy)});renderRules();await refresh()}catch(err){alert(err.message)}}
async function answer(id,choice){try{await api('/api/dashboard/cards/'+id+'/answer',{method:'POST',body:JSON.stringify({choice})});await refresh()}catch(err){alert(err.message)}}
async function resolveCard(id){const reason=prompt('写一句处理结果');if(!reason)return;try{await api('/api/dashboard/cards/'+id+'/resolve',{method:'POST',body:JSON.stringify({reason})});await refresh()}catch(err){alert(err.message)}}
async function refresh(){try{state=await api('/api/dashboard/state');renderSummary();renderCards();renderRuns()}catch(err){$('#service').textContent='服务连接失败';$('.dot').style.background='var(--red)'}}
async function loadRules(){try{rules=await api('/api/dashboard/rules');renderRules()}catch(err){alert(err.message)}}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-nav]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===b.dataset.nav));$('#title').textContent=({home:'现在发生了什么',rules:'管理自动任务规则',runs:'运行记录',help:'使用说明'})[b.dataset.nav];if(b.dataset.nav==='rules')loadRules()});
$('#new-rule').onclick=()=>openEditor(null);$('#cancel-rule').onclick=()=>$('#rule-editor').style.display='none';$('#f-trigger').onchange=toggleTrigger;document.querySelector('#rule-editor form').onsubmit=saveRule;refresh();loadRules();setInterval(refresh,5000);
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
