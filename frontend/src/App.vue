<template>
  <router-view></router-view>
  <!-- Privacy screen: a full-viewport frosted-glass blur, dismissed on the next
       (non-modifier) key press or mouse click. Ephemeral — not persisted. -->
  <div v-if="showPrivacyScreen" class="privacy-screen" aria-hidden="true"></div>
</template>

<script>
import { onMounted, onBeforeUnmount, computed, watch } from "vue";
import { state, mutations } from "@/store"; // Import your store's mutations
import { globalVars } from "@/utils/constants";
mutations.setLoading("main-app", true);
export default {
  name: "app",
  computed: {},
  setup() {
    const showPrivacyScreen = computed(() => state.showPrivacyScreen);

    // The tab title can carry the open file's name (views/Files.vue), and the blur does not
    // cover the tab strip. Show only the app name while it is up.
    let titleBeforePrivacy = "";
    watch(showPrivacyScreen, (shown) => {
      if (shown) {
        titleBeforePrivacy = document.title;
        document.title = globalVars.name;
      } else if (titleBeforePrivacy) {
        document.title = titleBeforePrivacy;
        titleBeforePrivacy = "";
      }
    });

    const dismissPrivacy = (e) => {
      // Ignore modifier-only keypresses so they don't prematurely dismiss it.
      if (
        e instanceof KeyboardEvent &&
        ["Shift", "Control", "Alt", "Meta"].includes(e.key)
      ) {
        return;
      }
      mutations.setPrivacyScreen(false);
    };

    onMounted(() => {
      mutations.setLoading("main-app", false);
      // Query the loading element and remove it from the DOM
      const loadingDiv = document.getElementById("loading");
      if (loadingDiv) {
        loadingDiv.remove();
      }
      window.addEventListener("keydown", dismissPrivacy, true);
      window.addEventListener("mousedown", dismissPrivacy, true);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("keydown", dismissPrivacy, true);
      window.removeEventListener("mousedown", dismissPrivacy, true);
    });

    return { showPrivacyScreen };
  },
};
</script>

<style>
/* Always load styles.css */
@import "./css/styles.css";
@import "./css/dark.css";

/* Privacy screen — full-viewport frosted-glass blur over the entire app. Above toasts, the
   preview loading overlay and the player's playback message (all 10000); only the idle
   warning (10002) sits higher. */
.privacy-screen {
  position: fixed;
  inset: 0;
  z-index: 10001;
  /* Tint at 50% strength (halved from the original wash). */
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px) brightness(1.03);
  -webkit-backdrop-filter: blur(10px) brightness(1.03);
  cursor: pointer;
}
</style>
