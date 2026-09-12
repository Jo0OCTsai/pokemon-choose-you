import "./dex.css";
import { createApp } from "vue";
import { i18n } from "./i18n";
import PetApp from "./PetApp.vue";

createApp(PetApp).use(i18n).mount("#app");
