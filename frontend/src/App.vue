<template>
  <router-view></router-view>
  <!-- Privacy screen: a full-viewport frosted-glass blur, dismissed on the next
       (non-modifier) key press or mouse click. Ephemeral — not persisted. -->
  <div v-if="showPrivacyScreen" class="privacy-screen" aria-hidden="true"></div>
</template>

<script>
import { onMounted, onBeforeUnmount, computed } from "vue";
import { state, mutations } from "@/store"; // Import your store's mutations
mutations.setLoading("main-app", true);
export default {
  name: "app",
  computed: {},
  setup() {
    const showPrivacyScreen = computed(() => state.showPrivacyScreen);

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

/* Privacy screen — full-viewport frosted-glass blur over the entire app. */
.privacy-screen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px) brightness(1.06);
  -webkit-backdrop-filter: blur(10px) brightness(1.06);
  cursor: pointer;
}
</style>
