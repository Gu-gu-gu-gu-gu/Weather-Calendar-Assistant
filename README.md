# 🌤 天气与日历小助手

一个面向 SillyTavern 的前端扩展插件，用于在角色扮演中自动追踪世界时间、节假日、天气与角色生理周期，并将“世界状态”注入提示词，帮助模型维持时间一致性与剧情连贯性。

---

## ✨ 主要功能

- 解析 AI 回复中的时间/场景/地点字段，自动更新世界时间
- 中国地区 2004-2026 使用 chinese-days（含农历/调休）
- 其他地区使用 Nager.Date 公共 API
- 纪念日与生日提醒（支持 MM-DD / YYYY-MM-DD）
- 天气使用 Open-Meteo 真实数据（无 API Key）
- 女性角色生理周期模拟（可手动覆盖性别）
- 支持回退与重新初始化

---

## 📦 安装方式

### 方式一：SillyTavern 内置安装
1. 打开 SillyTavern → Extensions
2. 点击 “Install extension”
3. 粘贴仓库的克隆 URL
4. 点击 “Install”
5. 刷新 SillyTavern 页面

### 方式二：手动安装
1. 下载仓库压缩包并解压
2. 放入以下路径：SillyTavern/public/scripts/extensions/third-party/
3. 刷新 SillyTavern 页面

---

## 🧭 使用说明

- 启用插件后，模型输出包含时间字段即可自动解析
- 若未解析出时间，会提示并停止注入
- 支持手动填写正则与字段 Key
- 支持从最新 AI 消息初始化
- 若无法解析地点，则使用设置里的默认城市

---

## 更新日志
详见 CHANGELOG.md

---

## 📸 截图展示

![设置面板](assets/screenshot-1.png)
![提示词注入效果](assets/screenshot-2.png)

---

## ⚠️ 关于 Nager.Date 公共 API

- 本插件在非中国或超出 2004-2026 年时会调用 Nager.Date
- 该服务为公共 API，稳定性与限流不可完全保证
- 已内置缓存逻辑，实际请求量极低

---

## ⚠️ 关于 Open-Meteo

- 本插件使用 Open‑Meteo 提供的地理编码与天气数据
- 无需 API Key，适用于非商业用途
- 若时间线超出预报范围，会使用历史同日数据作为参考

---

## ❤️ 致谢

- [chinese-days](https://github.com/vsme/chinese-days)（MIT）
- [Nager.Date](https://date.nager.at)（Public API）
- [Open-Meteo](https://open-meteo.com)（Open Weather API）
