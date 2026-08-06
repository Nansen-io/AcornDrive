import { createApp } from "vue";
import router from "./router"; // Adjust the path as per your setup
import App from "./App.vue"; // Adjust the path as per your setup
import { state } from "@/store"; // Adjust the path as per your setup
import i18n from "@/i18n";
import VueLazyload from "vue-lazyload";
import VuePlyr from "@skjnldsv/vue-plyr"; // Custom media player
import { listenForSingleLogout } from "@/utils/slo";

import "./css/styles.css";

const app = createApp(App);

// Install additionals
app.use(VueLazyload);
app.use(i18n);
app.use(router);
app.use(VuePlyr);

// Provide state to the entire application
app.provide("state", state);

// provide v-focus for components
app.directive("focus", {
  mounted: (el) => {
    // A longer timeout is sometimes needed to win a "focus race"
    // against other parts of the app that might be managing focus.
    setTimeout(() => {
      el.focus();
    }, 100);
  },
});

app.mixin({
  mounted() {
    // expose vue instance to components
    this.$el.__vue__ = this;
  },
});

// Listen for the hub's sign-out before mounting, so a tab that is already open is covered
// from the first moment rather than after the app finishes booting. See utils/slo.ts.
listenForSingleLogout();

router.isReady().then(() => app.mount("#app"));
