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
