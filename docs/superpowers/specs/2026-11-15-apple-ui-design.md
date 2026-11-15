# 0.5.7：Apple 风格管理页面

## 目标
在不改变功能、可访问名称与测试钩子的前提下，把 WebUI 改为 Apple Human Interface 风格，提升审美与手机端操作体验。技术栈保持 React + Tailwind v4 + shadcn/ui（Radix）+ Sonner。

## 设计要点
- 令牌：iOS systemGroupedBackground / secondarySystemGroupedBackground、label/secondaryLabel、separator、系统蓝绿橙红；`prefers-color-scheme` 自动深浅色（移除固定 `dark` 类）。
- 字体：-apple-system / SF Pro / PingFang SC，回退 MiSans、OPlusSans、系统字体。
- 组件：`ui/ios.tsx` 提供 LargeTitle、Group（inset grouped，细分隔线从文字处开始）、Row、IconTile、Pill、Notice、sheet 样式；CSS 提供 `.segmented`、`.ios-switch`（保留 checkbox 语义）、`.range-input`、`.material`。
- 按钮：胶囊形，filled / gray / tinted / plain，无描边。
- 弹层：手机为底部 sheet + 导航栏式头部，宽屏为居中卡片。
- 导航：手机为毛玻璃标签栏，宽屏为侧边栏。
