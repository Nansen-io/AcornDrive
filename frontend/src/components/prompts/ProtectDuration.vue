<template>
  <div class="card-title">
    <h2>{{ $t("prompts.protectDuration") }}</h2>
  </div>

  <div class="card-content">
    <p>{{ $t("prompts.protectDurationMessage") }}</p>
    <div class="protect-input-row">
      <label class="protect-label" for="protect-period">{{ $t("prompts.protectPeriodLabel") }}</label>
      <select
        id="protect-period"
        class="input protect-period-select"
        v-model.number="hours"
        v-focus
        @keyup.enter="submit"
      >
        <option v-for="period in periods" :key="period.key" :value="period.hours">
          {{ $t("prompts." + period.i18n) }}
        </option>
      </select>
    </div>
  </div>

  <div class="card-action">
    <button
      class="button button--flat button--grey"
      @click="closeHovers"
      :aria-label="$t('general.cancel')"
    >
      {{ $t("general.cancel") }}
    </button>
    <button
      class="button button--flat"
      :disabled="!validHours"
      @click="submit"
      :aria-label="$t('buttons.protect')"
    >
      {{ $t("buttons.protect") }}
    </button>
  </div>
</template>

<script>
import { mutations } from "@/store";
import { chainfsApi } from "@/api";
import { notify } from "@/notify";
import { PROTECT_PERIODS, DEFAULT_PROTECT_HOURS } from "@/utils/protection.js";

export default {
  name: "ProtectDuration",
  props: {
    item: {
      type: Object,
      required: true,
    },
    source: {
      type: String,
      required: true,
    },
  },
  data() {
    return {
      // Still hours on the wire -- the server computes now + hours * time.Hour and
      // nothing about existing protections changes. What moved is that a person no
      // longer has to think in hours, or type 43800 and get it right.
      hours: DEFAULT_PROTECT_HOURS,
    };
  },
  computed: {
    periods() {
      return PROTECT_PERIODS.map((p) => ({
        key: p.key,
        hours: p.hours,
        i18n:
          "protectPeriod" + p.key.charAt(0).toUpperCase() + p.key.slice(1),
      }));
    },
    validHours() {
      // A period picked from the list is always valid; this guards against the value
      // being cleared or tampered with, so we never send a nonsense expiry.
      return (
        Number.isInteger(this.hours) &&
        PROTECT_PERIODS.some((p) => p.hours === this.hours)
      );
    },
  },
  methods: {
    closeHovers() {
      mutations.closeHovers();
    },
    async submit() {
      if (!this.validHours) return;
      mutations.closeHovers();
      const toastId = notify.showToast("info", this.$t("prompts.protectUploading"), {
        icon: "sync",
        duration: 0,
      });
      const minEnd = Date.now() + 1500;
      try {
        await chainfsApi.protectFile(this.source, this.item.path, this.hours);
        const remaining = minEnd - Date.now();
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
        notify.closeToast(toastId);
        notify.showSuccessToast(this.$t("buttons.protectSuccess"));
        mutations.setReload(true);
      } catch (_) {
        const remaining = minEnd - Date.now();
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
        notify.closeToast(toastId);
        // error already shown by API layer
      }
    },
  },
};
</script>

<style scoped>
.protect-input-row {
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin-top: 0.75em;
}

.protect-period-select {
  min-width: 10em;
}

.protect-label {
  color: var(--textSecondary, #888);
  font-size: 0.9em;
}

.protect-unit {
  color: var(--textSecondary, #888);
  font-size: 0.9em;
}
</style>
