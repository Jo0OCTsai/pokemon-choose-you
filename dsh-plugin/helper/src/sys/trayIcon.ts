/**
 * 托盘状态栏图标（macOS 惯例：单色模板图，系统按菜单栏深浅色自动反色）。
 * 精灵球剪影 36×36@2x（=18pt）内嵌 base64——nativeImage 只解 PNG/JPEG，喂精灵 GIF
 * 得空图像（Tray 图标空转的真因）；内嵌常量免去构建管线与仓库二进制资产。
 * 图形 = 黑盘 + 镂空中带 + 中心钮（alpha 通道承载，黑色 RGB 固定）。
 */
const TRAY_ICON_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAZElEQVR42u3YwQ0AIAhDUfZfuo5gSEA/oSS9v4sIRLjqS8lgIK0wFQUDKYGpOShMGoUC6XFQmCsKBdLnGDQfVN08cWOIQWNHDT/7XX3Ivz1xJvJMPWbzmL8oIldp7LEBeY7ZWQddOu0vewt/4AAAAABJRU5ErkJggg==";

export function trayIconPng(): Buffer {
  return Buffer.from(TRAY_ICON_PNG_B64, "base64");
}
