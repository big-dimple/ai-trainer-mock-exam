# -*- coding: utf-8 -*-
"""调用 OpenAI 兼容接口的大模型为主观题评卷，结果写入 feedback/<id>.json。

python grader.py --ping          测试模型连通
python grader.py <submission_id> 手动评一份答卷
"""
import json, re, sys, time, pathlib, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

APP = pathlib.Path(__file__).resolve().parent
BANK = APP / "data" / "bank"
SUBMIT = APP / "submissions"
FEEDBACK = APP / "feedback"
DOCS = APP.parent / "备考输出"
KP = {"ethics": "职业道德与AI伦理", "law": "法律法规与知识产权", "office": "计算机与办公", "security": "AI安全与质量",
      "bpm": "业务分析与流程", "product": "产品与用户增长", "pm": "项目管理", "training": "培训与指导",
      "ml": "机器学习", "dl": "深度学习", "algo": "数据结构与算法", "data": "数据工程与智能训练",
      "llm": "大模型与生成式AI", "aisys": "智能系统设计"}

SYSTEM = """你是“人工智能训练师（二级/技师）”职业技能竞赛的资深评委，负责主观题阅卷。
评分原则：
1. 严格按给定的评分要点逐项给分，每项不超过该项分值，可给小数（0.5 为单位）。
2. 看实质不看措辞：意思正确、要点到位即可得分；只堆砌名词、没有展开或与题目场景无关的，酌情减分。
3. 题面硬性要求（数量、格式、必含字段、时间周期等）未满足的，对应要点明显扣分。
4. 作答空白、答非所问给 0 分。
5. 参考答案仅供评委对照，考生不必与其一致。
只输出一个 JSON 对象，不要输出其他文字。"""

_bank_cache = {"mtime": None, "byid": {}}
_lock = threading.Lock()


def load_bank():
    mt = max((f.stat().st_mtime for f in BANK.glob("*.json")), default=0)
    if _bank_cache["mtime"] != mt:
        byid = {}
        for f in BANK.glob("*.json"):
            try:
                for q in json.loads(f.read_text(encoding="utf-8")):
                    byid[q.get("id")] = q
            except Exception:
                pass
        _bank_cache.update(mtime=mt, byid=byid)
    return _bank_cache["byid"]


def doc_section(text, anchor):
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        m = re.match(r"^(#{2,4})\s", ln)
        if m and anchor in ln:
            lvl = len(m.group(1))
            j = i + 1
            while j < len(lines) and not re.match(r"^#{1,%d}\s" % lvl, lines[j]):
                j += 1
            return "\n".join(lines[i:j])
    return text


def reference_of(q):
    ref = q.get("reference") or ""
    doc = q.get("referenceDoc")
    if doc and (DOCS / doc).is_file():
        t = (DOCS / doc).read_text(encoding="utf-8")
        ref += "\n" + (doc_section(t, q["referenceAnchor"]) if q.get("referenceAnchor") else t)
    return ref.strip()[:14000]


class LLM:
    def __init__(self, cfg):
        self.base = cfg.get("base_url", "").rstrip("/")
        self.key = cfg.get("api_key", "")
        self.model = cfg.get("model", "")
        self.timeout = int(cfg.get("timeout", 300))
        self.max_tokens = int(cfg.get("max_tokens", 8192))
        self.temperature = float(cfg.get("temperature", 0.2))

    @property
    def ok(self):
        return bool(self.base and self.model)

    def chat(self, system, user):
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        # 新模型（OpenAI gpt-5+/o 系列）用 max_completion_tokens 且可能不支持 temperature；
        # 旧接口用 max_tokens。遇到 "Unsupported parameter" 就自动剔除对应参数重试。
        params = {"max_completion_tokens" if "openai.com" in self.base else "max_tokens": self.max_tokens,
                  "temperature": self.temperature}
        req_headers = {"Content-Type": "application/json", "Authorization": "Bearer " + self.key}
        last = None
        for attempt in range(4):
            body = {"model": self.model, "messages": messages, **params}
            req = urllib.request.Request(self.base + "/chat/completions", data=json.dumps(body).encode("utf-8"),
                                         headers=req_headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    data = json.loads(r.read().decode("utf-8"))
                content = data["choices"][0]["message"].get("content") or ""
                return re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:300]}"
                m = re.search(r"Unsupported (?:parameter|value): '(\w+)'", last)
                if e.code == 400 and m and m.group(1) in params:
                    del params[m.group(1)]
                    continue
                if e.code < 500 and e.code != 429:
                    break
            except Exception as e:
                last = str(e)
            time.sleep(3 * (attempt + 1))
        raise RuntimeError(last or "LLM 调用失败")

    def chat_json(self, system, user):
        text = self.chat(system, user)
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise ValueError("模型未返回 JSON：" + text[:200])
        return json.loads(m.group(0))


def build_prompt(item, q, sub):
    is_case = q and q.get("type") == "case"
    max_score = item.get("max") or (q or {}).get("score", 10)
    points = (q.get("checklist") if is_case else q.get("rubric")) if q else None
    points = points or [{"point": "整体作答质量", "score": max_score}]
    pts_txt = "\n".join(f"{i + 1}. {p.get('point') or p.get('item')}（{p['score']} 分）" for i, p in enumerate(points))
    head = f"实操/综合评审题 {q.get('module')}（满分 {max_score}，限时 {q.get('minutes')} 分钟，考生用时 {sub.get('durationMin', '?')} 分钟）" if is_case else f"简答题（满分 {max_score}）"
    stem = q.get("stem") if q else item.get("stem")
    ref = reference_of(q) if q else ""
    user = f"""【题型】{head}

【题目】
{stem}

【评分要点】
{pts_txt}

【参考答案（评委对照用）】
{ref or '（无）'}

【考生作答】
{item.get('answer') or '（空白）'}

请输出 JSON：
{{"points":[{{"point":"要点原文","max":分值,"score":得分,"reason":"一句话说明给分理由"}}],
 "score":总分,
 "comment":"Markdown 评语，包含三部分：**亮点**、**主要缺漏**、**改进写法**（给出 2-4 句可直接誊抄进答卷的示范表述）"}}
points 必须与评分要点一一对应、顺序一致；score 等于各项得分之和。"""
    return user, points, max_score


def grade_item(llm, item, sub, byid):
    q = byid.get(item.get("qid"))
    user, points, max_score = build_prompt(item, q, sub)
    res = llm.chat_json(SYSTEM, user)
    got = res.get("points") or []
    rows, total = [], 0.0
    for i, p in enumerate(points):
        mx = float(p["score"])
        g = got[i] if i < len(got) and isinstance(got[i], dict) else {}
        try:
            sc = max(0.0, min(mx, float(g.get("score", 0))))
        except (TypeError, ValueError):
            sc = 0.0
        total += sc
        rows.append(f"| {p.get('point') or p.get('item')} | {sc:g}/{mx:g} | {str(g.get('reason', '')).replace('|', '/')} |")
    total = round(min(total, max_score), 1)
    table = "| 评分要点 | 得分 | 理由 |\n|---|---|---|\n" + "\n".join(rows)
    return {"qid": item.get("qid"), "score": total, "max": max_score, "autoScore": item.get("autoScore"),
            "comment": (res.get("comment") or "").strip() + "\n\n" + table}


def summarize(llm, sub, items):
    kp_sum = dict(sub.get("kpSummary") or {})
    for it in items:
        q = load_bank().get(it["qid"]) or {}
        k = kp_sum.setdefault(q.get("kp", "?"), {"got": 0, "max": 0})
        if "kpSummary" in sub:
            k["got"] += it["score"] - (it.get("autoScore") or 0)
        else:
            k["got"] += it["score"]
            k["max"] += it["max"]
    ratios = sorted(((v["got"] / v["max"], k) for k, v in kp_sum.items() if v.get("max")), key=lambda x: x[0])
    weak = [k for r, k in ratios if r < 0.7][:3]
    lines = [f"- {KP.get(k, k)}：{v['got']:g}/{v['max']:g}" for k, v in kp_sum.items() if v.get("max")]
    subj = [f"- {it['qid']}：{it['score']:g}/{it['max']:g}" for it in items]
    wrong_kps = {}
    for w in sub.get("wrong") or []:
        wrong_kps[w.get("kp")] = wrong_kps.get(w.get("kp"), 0) + 1
    if sub.get("objMax"):
        obj = f"客观题得分 {sub.get('objScore')}/{sub.get('objMax')}，错 {len(sub.get('wrong') or [])} 题"
    elif sub.get("wrong"):
        obj = f"客观题错 {len(sub['wrong'])} 题"
    else:
        obj = "本次没有客观题，只评价主观题，不要评论客观题"
    prompt = f"""考生刚完成《{sub.get('title')}》。{obj}。
各知识点得分：
{chr(10).join(lines) or '（无）'}
主观题 AI 评分：
{chr(10).join(subj) or '（无）'}
客观题错题按知识点计数：{json.dumps({KP.get(k, k): v for k, v in wrong_kps.items()}, ensure_ascii=False)}

请输出 JSON：{{"summary":"Markdown，3-5 句总体评价与主要短板","next_actions":["3-4 条具体、可执行的下一步练习建议"]}}"""
    try:
        res = llm.chat_json("你是人工智能训练师（二级）备考教练，语言简洁具体。只输出 JSON。", prompt)
        return res.get("summary", ""), res.get("next_actions") or [], weak
    except Exception:
        return "、".join(f"{KP.get(k, k)}" for k in weak) + " 是当前短板。" if weak else "整体表现稳定。", \
               [f"做 {KP.get(k, k)} 专项 20 题" for k in weak], weak


def grade_submission(llm, sid, progress=None):
    """progress(done, total) 回调用于前端进度显示"""
    sub = json.loads((SUBMIT / f"{sid}.json").read_text(encoding="utf-8"))
    items_in = sub.get("subjective") or []
    byid = load_bank()
    done = [0]

    def one(it):
        try:
            r = grade_item(llm, it, sub, byid)
        except Exception as e:
            r = {"qid": it.get("qid"), "score": it.get("autoScore") or 0, "max": it.get("max"), "autoScore": it.get("autoScore"),
                 "comment": f"⚠️ AI 评卷失败（{e}），暂按关键词预估分计。可在评卷记录中点“重新评卷”。", "failed": True}
        with _lock:
            done[0] += 1
            if progress:
                progress(done[0], len(items_in))
        return r

    with ThreadPoolExecutor(max_workers=3) as ex:
        items = list(ex.map(one, items_in))
    subj_total = sum(i["score"] for i in items)
    if sub.get("kind") == "exam":
        total, mx = round((sub.get("objScore") or 0) + subj_total, 1), sub.get("maxScore")
    else:
        total, mx = round(subj_total, 1), sum(i["max"] or 0 for i in items)
    summary, actions, weak = summarize(llm, sub, items)
    fb = {"submission_id": sid, "graded_at": time.strftime("%Y-%m-%dT%H:%M"), "grader": llm.model,
          "total": total, "max": mx, "summary": summary, "items": items, "weak_kps": weak, "next_actions": actions}
    if all(i.get("failed") for i in items) and items:
        raise RuntimeError(items[0]["comment"])
    (FEEDBACK / f"{sid}.json").write_text(json.dumps(fb, ensure_ascii=False, indent=1), encoding="utf-8")
    return fb


if __name__ == "__main__":
    sys.path.insert(0, str(APP))
    from server import load_config
    llm = LLM(load_config()["llm"])
    if not llm.ok:
        sys.exit("未配置 llm：先运行 python tools/import_pi_model.py 或编辑 config.json")
    if "--ping" in sys.argv:
        t = time.time()
        print(llm.chat_json("只输出 JSON。", '输出 {"ok": true, "model": "你的模型名"}'), f"{time.time() - t:.1f}s")
    elif len(sys.argv) > 1:
        print(json.dumps(grade_submission(llm, sys.argv[1], lambda d, n: print(f"{d}/{n}")), ensure_ascii=False, indent=1)[:3000])
