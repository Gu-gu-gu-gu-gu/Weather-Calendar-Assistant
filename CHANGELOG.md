# Changelog

### v1.4.1

- Removed the “Rain Bias” setting and simplified the weather continuity logic
- Fixed an issue where the weather type could change after continuity adjustment but the `isRainy` flag was not updated accordingly
- Unified all weather sources (API + roll) to always include a correct `isRainy` flag
- Adjusted season mapping so that September is treated as summer, avoiding unrealistically low temperatures in early autumn for South China
- Slightly increased the daily mean temperature for low‑latitude regions (|latitude| ≤ 25°) during September–November to better match perceived temperatures
- Slightly optimized the temperature continuity calculation to reduce extreme day‑to‑day temperature jumps

### v1.4.0

- 支持中英双语界面（自动识别 + 手动切换）
- 默认跟随 SillyTavern 语言设置
- 英文时间解析优化（支持常见日期/时间格式）
- 地点解析优化（支持多种写法）
- 无需固定格式也可自动识别地点（兜底解析）

### v1.3.0
- 新增 WORLD 固定格式解析模式（仅解析 [[WORLD]]...[[/WORLD]]）
- 新增 WORLD 提示词注入开关（可关闭注入，仅保留解析）
- 解析设置面板默认折叠，界面更简洁
- 一键检测按钮（出现bug请将结果复制发我，由于会将最近一次AI输出内容一起复制，记得删掉隐私内容）
- 修复节假日 API 将“星期几”误识别为节日的问题
- 移除场景字段解析与注入，节省 token
- 经期系统新增年龄输入，年龄会影响周期模拟与波动概率

### v1.2.3
- 新增正则预设功能：时间/场景/地点三项一键保存与下拉切换
- 新增删除当前预设按钮，支持清理旧预设

### v1.2.2
- 古代模式下新增“随机公历基年”，无需手动设置起始年份也能正常递进
- 古代时间解析兼容农历 + 时辰写法（如“七月初三 未时”）

## v1.2.1
- 纪念日支持绑定角色卡（多选），仅在对应角色聊天时注入
- 纪念日角色选择支持搜索、全选、清空

## v1.2.0
- 新增古代模式：注入改为农历 + 节气 + 时辰
- 支持年号前缀自动识别与递进
- 天气/经期文案古风化
- 新增古地名→现代地名映射用于天气查询
- 修复 Chinese Days 农历/节气的正确调用方式，现代模式农历恢复
- 兼容 PC/移动端设置面板挂载时机

> 更新后需联网使用；古代模式建议 AI 输出“年号+年”一次

## v1.1.2

- 修复 PC / 移动端设置面板挂载时机问题
- 修复 parser.js 语法重复导致插件加载失败的问题

---

## v1.1.1

- 自定义时间/场景/地点正则支持多捕获组，自动使用最后一个非空捕获组
- 地点解析失败时自动回退使用场景字段

> 更新后需确保 LLM 至少输出一次城市或手动在设置面板选择城市，否则无法调用 Open-Meteo

---

## v1.1.0

- 接入 Open-Meteo API，根据地区历史气候优化天气 roll 点
- 支持地点解析与默认城市
- 天气连续性与未来时间兜底
- 支持多人角色经期模拟

> 更新后需联网使用
