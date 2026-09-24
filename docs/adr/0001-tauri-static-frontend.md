# 0001 — Tauri v2 + 纯静态前端，不引入前端框架

技术栈选择 Tauri v2（Rust 后端 + Web 前端），前端使用纯 HTML/CSS/JS，无 node_modules、无构建链。

选择理由：点名器功能简单，避免引入 Electron 的大体积（~100MB vs ~10MB）和前端构建复杂链。被否决的替代方案：Electron（打包大、内存高）、Python + PySide6（界面偏传统）、WPF/.NET（仅限 Windows）。若未来功能大幅膨胀（如多班级管理、成绩统计），迁移到 React + Vite 仍可行（Tauri 前端层与后端命令接口不变）。