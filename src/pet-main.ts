import "@fontsource/press-start-2p";
import "@vp-tw/cjk-web-fonts-fusion-pixel-font/dist/12px/proportional/zh_hans/Fusion-Pixel-12px-Proportional-Simplified-Chinese.css";
import "./dex.css";
import { createApp } from "vue";
import { createPinia } from "pinia";
import { bindLocaleToSettings, i18n } from "./i18n";
import PetApp from "./PetApp.vue";

const app = createApp(PetApp);
app.use(createPinia());
app.use(i18n);
bindLocaleToSettings();
app.mount("#app");
