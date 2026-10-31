# 人工智能训练师（二级）刷题系统

## 启动
双击项目根目录 `启动刷题系统.bat`（或在 `exam-app` 目录运行 `python server.py`），浏览器打开 http://127.0.0.1:8848/ 。只依赖 Python 标准库。

## 功能
| 页面 | 用途 |
|---|---|
| 学习看板 | 2026 样卷必考题掌握进度（连续答对 2 次算掌握）、倒计时、14 天计划、知识点掌握度、短板诊断 |
| 模拟考试 | **2026 必考卷**（默认）：按 2026 框架判断 20×0.5 / 单选 80×0.5 / 多选 10×1 / 简答 8×5，样卷 83 道理论题每次全部入卷（打乱），余量按短板加权补足；另有样卷原卷、样卷客观题打乱卷、2025 框架卷等 |
| 专项练习 | 选知识点/题型/题源（含“仅 2026 样卷”），逐题即时判分 + 解析 + 答题思路；样卷题抽中权重 ×3 |
| 错题本 | 错题自动收录，连续答对 2 次移出 |
| 实操 B/C | 2026 样卷 B1.1~C（排在每个模块首位）+ 2025 真题 + 新编案例，限时作答，checklist 自评 + 参考答案 |
| 真题 / 样卷解析 | 2026 样卷 / 2025 真题切换：理论题答案 + 解析 + 答题思路，可遮挡答案自测；参考文档 |

2026 样卷素材在根目录 `2026样卷/`，参考答案在 `备考输出/2026/`（B1.2、B2 参考 notebook 已实际运行，见 `备考输出/2026/notebooks/`）。题库由 `tools/build_y2026.py`（理论题）+ `tools/y2026_cases.py`（实操题）生成 `data/bank/y2026_sample.json`，notebook 由 `tools/make_y2026_notebooks.py` 重新生成。
| 评卷记录 | 主观题提交记录与 AI 评卷结果 |

## AI 评卷
- **服务端自动评卷**：交卷后答卷存到 `submissions/`，服务端调用 `config.json` 里配置的大模型（OpenAI 兼容接口），按评分要点逐项打分，写入 `feedback/`。页面自动轮询显示分数、逐项理由与改进写法，并修正知识点掌握度。评卷记录页可“重新评卷”。公开部署时服务端内置限流（每 IP 每小时 8 次、每用户每天 20 次、最多 2 个并发），防止 API 额度被刷。

### 配置评卷模型
```bash
python tools/import_pi_model.py glm-5.3-flash   # 从 ~/.pi/agent/models.json 导入，生成 config.json
python grader.py --ping                         # 测试连通
```
也可以复制 `config.example.json` 为 `config.json` 手动填写，或用环境变量 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 覆盖。`config.json` 含密钥，已被 `.gitignore` 排除。

## 部署到公网服务器（ai.hp666.cc 已按此部署）
1. 服务器安装 Python 3.8+，拉取代码（release 分支为部署分支）：
   ```bash
   git clone -b release git@github.com:big-dimple/ai-trainer-mock-exam.git /var/www/ai-trainer
   ```
2. 配置密钥（二选一，推荐环境变量，密钥不落 git）：
   - 复制 `deploy/env.example` 为 `/etc/ai-trainer-exam.env` 并 `chmod 600`，填好 `EXAM_PASSWORD` 与 `LLM_*`；
   - 或在 `exam-app/` 下创建 `config.json`（参考 `config.example.json`）：`host` 设 `0.0.0.0`，**必须设置 `auth.password`**；`llm.base_url` 必须是**服务器能访问到的地址**（内网网关需反代/穿透，或换公网可达接口）。
3. 安装 systemd 服务并启动：
   ```bash
   sudo cp deploy/ai-trainer-exam.service /etc/systemd/system/   # 按实际路径改 WorkingDirectory
   sudo systemctl daemon-reload && sudo systemctl enable --now ai-trainer-exam
   ```
4. nginx 反代参考（已部署实例）：`proxy_pass http://127.0.0.1:8848`，`proxy_read_timeout 360s`（AI 评卷长请求）；HTTPS 用 `certbot --nginx -d <域名>`。
5. 日常更新：本地把改动推到 `release` 分支后，服务器 cron（`deploy/deploy.sh` 同逻辑）每分钟自动拉取、重启、健康检查；也可手动执行 `bash deploy/deploy.sh`。
6. 数据都在 `exam-app/data/progress.json`（启动时自动备份到 `data/backups/`，保留最近 10 份）、`submissions/`、`feedback/`，均为 gitignore 文件，`git reset --hard` 更新不会动它们。系统按单用户设计，多人共用会共享同一份进度。

## 数据
- `data/bank/*.json`：题库（`y2025_*` 真题；`new_*` 新编；`ai_round*` AI 按短板追加）
- `data/progress.json`：做题进度（也存浏览器 localStorage）
- `tools/validate.py`：题库校验；`tools/build_y2025*.py`：从 `_text/` 重建真题数据
