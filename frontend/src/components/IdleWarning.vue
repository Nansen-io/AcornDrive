<template>
  <!-- The last five minutes before the idle sign-out. See utils/idle.ts. -->
  <div v-if="idle.warning" class="idle-warning" role="status">
    <span>{{ $t("messages.idleWarning", { time: countdown }) }}</span>
    <button type="button" class="idle-warning-button" @click="stay">
      {{ $t("buttons.staySignedIn") }}
    </button>
  </div>
</template>

<script>
import { idle, recordActivity } from "@/utils/idle";

export default {
  name: "IdleWarning",
  data() {
    return { idle };
  },
  computed: {
    // m:ss rather than words, so no plural rules are needed in any language.
    countdown() {
      const total = Math.ceil(Math.max(this.idle.remainingMs, 0) / 1000);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    },
  },
  methods: {
    stay() {
      recordActivity();
      this.idle.warning = false;
    },
  },
};
</script>

<style scoped>
/* Above the privacy screen (10001): it reveals nothing about her files. */
.idle-warning {
  position: fixed;
  bottom: 1.5em;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10002;
  display: flex;
  align-items: center;
  gap: 1em;
  max-width: calc(100vw - 2em);
  padding: 0.75em 1em;
  border-radius: 0.5em;
  background: #ffffff;
  color: #1f2933;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  font-size: 0.95em;
}
.idle-warning-button {
  flex-shrink: 0;
  padding: 0.5em 1em;
  border: none;
  border-radius: 0.4em;
  background: #3a7d82;
  color: #ffffff;
  font-weight: 600;
  cursor: pointer;
}
</style>
