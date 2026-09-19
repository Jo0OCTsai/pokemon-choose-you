import "@fontsource/press-start-2p";
// 中文像素展示层（Fusion Pixel 12px 比例版，SIL OFL）：按 unicode 块切 78 个子集，
// Vite 打包后为本地资源——本地优先，断网不掉字（DESIGN_SYSTEM.md §2 字体三级）
import "@vp-tw/cjk-web-fonts-fusion-pixel-font/dist/12px/proportional/zh_hans/Fusion-Pixel-12px-Proportional-Simplified-Chinese.css";
import "./dex.css";
import { createApp } from "vue";
import { createPinia } from "pinia";
import { bindLocaleToSettings, i18n } from "./i18n";
import App from "./App.vue";

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
bindLocaleToSettings();
app.mount("#app");
