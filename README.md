<div align="center">
  <img src="https://github.com/user-attachments/assets/11a2cb7d-f8c1-49a1-a8e8-719927045cdb" alt="JM-Aura" width="230" height="230" />

  <h1><i>JM-Aura</i></h1>
  <p><i>一个简洁、优雅的 JMComic 漫画阅读/下载 Web 应用</i></p>

  [![GitHub](https://img.shields.io/badge/-GitHub-181717?logo=github)](https://github.com/Tom6814)
  [![GitHub license](https://img.shields.io/github/license/Tom6814/JM-Aura)](https://github.com/Tom6814/JM-Aura/blob/master/LICENSE)
  [![Python Version](https://img.shields.io/badge/python-3.10+-blue?logo=python)](https://www.python.org/)
</div>

---

# 🔍这是什么？

✨**JM-Aura** 是一个基于 **JMComic** API开发的🌟第三方JMComic的本地/自建 Web 应用🤗

你只需要启动一次后端服务，然后用浏览器打开 `<服务器IP>:8000`（默认），就能完成 **搜索、浏览、收藏、历史、阅读、批量下载与打包 JMComic 漫画** 等操作😆

<div align="center">
<img width="1919" height="1030" alt="电脑端界面" src="https://github.com/user-attachments/assets/53b48077-9766-4175-aa2f-e366ff471e8d" />

<img width="691" height="954" alt="手机/平板端界面" src="https://github.com/user-attachments/assets/3c803d27-5232-497f-85d6-478197e3bf7a" />

</div>


项目结构很简单：

- 后端：FastAPI（同时负责 API 与静态前端资源分发）
  
- 前端：Vue3（CDN，无需构建）
  
- 站点图标：在项目根目录放置 `favicon.ico`，会自动作为浏览器标签图标




## 它能干嘛？实现了JMComic的哪些功能？


- **浏览与搜索**：按关键词搜索标题/作者/标签；按分类/排行/最新浏览。
  
- **沉浸阅读**：长条漫垂直滚动；阅读器模式自动隐藏顶/底栏，减少干扰。
  
- **收藏与历史**：收藏页、历史页独立入口；移动端入口做了融合，减少按钮拥挤。
  
- **下载与打包**：支持选择章节下载；后台任务进度展示；完成后可直接下载 ZIP。
  
- **网络与线路**：内置图片代理/多线路机制（遇到加载问题可以切换）。





## 🚀 服务器部署（推荐）

适合想要 **24 小时挂机下载/远程阅读** 的用户。以下以 Ubuntu/Debian 为例（其它 Linux 发行版可能略有不同）。


### 1) 准备环境

- 一台 Linux 服务器 **（确保能正常访问外网）**
- Python 3.10+（推荐 3.11+）

### 2) 上传/放置代码

把代码放到服务器某个目录（例如 `/opt/jm-aura`）

方式任选：

- 方式一：`git clone https://github.com/Tom6814/JM-Aura.git <运行项目的目录>`（推荐）
- 方式二：上传你打包好的 zip 并解压到运行项目的目录

  
### 3) 安装依赖

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip

cd <运行项目的目录>
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

### 4) 启动（前台）

```bash
cd <运行项目的目录>
JM_AURA_HOST=0.0.0.0 JM_AURA_PORT=8000 ./.venv/bin/python -m backend.main
```

浏览器访问：
- `http://<你的服务器IP>:8000`


### 5) 后台运行（systemd，推荐）

创建服务文件：

```bash
sudo nano /etc/systemd/system/jm-aura.service
```

填入（注意修改路径为你的实际目录）：

```ini
[Unit]
Description=JM-Aura Web
After=network.target

[Service]
Type=simple
WorkingDirectory=<运行项目的目录>
ExecStart=<运行项目的目录>/.venv/bin/python -m backend.main
Restart=always

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jm-aura
```

查看状态/日志：

```bash
sudo systemctl status jm-aura
journalctl -u jm-aura -f
```





## 🍽️ 食用方法（怎么用）


### 登录/线路

- 打开页面后进入 **设置（Config）**，填入 JMComic 账号密码进行登录。
- 如遇到图片加载异常/线路问题，在设置里切换线路或重试（项目会记录可用线路）。

### 顶栏操作（电脑端）


- 顶栏会根据窗口宽度自动适配：
  
  - **优先压缩搜索框**，不够再把搜索框变为按钮（点击弹出输入框）
    
  - 再不够才隐藏按钮文字（只留图标）
    
  - 最后把非关键按钮收进“菜单”
    
- 顶栏按钮文字不会换行（避免难看抖动）。


### 阅读器模式

- 打开章节后进入阅读器：
  - 顶栏/底栏会自动隐藏（沉浸阅读）
  - 返回详情或其他页面后恢复正常导航

## ⚙️ 配置与文件（重要）

以下文件可能包含敏感信息，请不要上传/分享：
- `backend/config/cookies.json`：登录 Cookie
- `config/op.yml`：运行时线路/配置（可能包含访问细节）

建议做法：
- 分享代码时只保留 `config/op.example.yml`、`backend/config/cookies.example.json`
- `downloads/` 是下载产物目录（可自行清理/迁移）

## 🛠️ 常见问题

**Q: 页面能打开，但图片不显示/加载慢？**  
- 先多刷新几次试试，确认图片能正常加载；***确保服务器能正常访问外网***；必要时更换 DNS/代理环境。

**Q: 评论发不出去？**  
- 上游有风控，请避免过短/重复内容，稍等再发。

**Q: 如何更新？**  
- 覆盖更新代码后，执行一次依赖更新并重启即可：

```bash
pip install -r requirements.txt
python -m backend.main
```

## ⚠️ 免责声明

本项目仅供学习交流使用。使用者应遵守当地法律法规及目标网站使用条款；开发者不对使用本项目产生的任何后果负责。
