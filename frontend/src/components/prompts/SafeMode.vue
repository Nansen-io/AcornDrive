<template>
  <div class="card-title">
    <h2>{{ isRemoving ? $t("prompts.safeModeRemove") : (hasPIN ? $t("prompts.safeModeAdd") : $t("prompts.safeModeAddFirstTime")) }}</h2>
  </div>

  <div class="card-content">
    <p>{{ isRemoving ? $t("prompts.safeModeRemoveMessage") : (hasPIN ? $t("prompts.safeModeConfirmPIN") : $t("prompts.safeModeSetPIN")) }}</p>

    <div class="safemode-pin-row">
      <input
        ref="pinInput"
        class="input safemode-pin-input"
        type="text"
        inputmode="numeric"
        maxlength="4"
        pattern="[0-9]{4}"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        data-form-type="other"
        :placeholder="$t('prompts.safeModePINPlaceholder')"
        v-model="pin"
        v-focus
        @keyup.enter="!hasPIN && !isRemoving ? focusConfirm() : submit()"
        autocomplete="off"
      />
    </div>

    <div class="safemode-pin-row" v-if="!hasPIN && !isRemoving">
      <input
        ref="confirmInput"
        class="input safemode-pin-input"
        type="text"
        inputmode="numeric"
        maxlength="4"
        pattern="[0-9]{4}"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        data-form-type="other"
        :placeholder="$t('prompts.safeModePINConfirmPlaceholder')"
        v-model="pinConfirm"
        @keyup.enter="submit"
        autocomplete="off"
      />
    </div>

    <p v-if="errorMessage" class="safemode-error">{{ errorMessage }}</p>
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
      :class="{ 'button--red': isRemoving }"
      :disabled="!canSubmit || loading"
      @click="submit"
    >
      <span v-if="loading" class="safemode-loading-btn">
        <i class="material-icons spin">sync</i>
        {{ isRemoving ? $t("prompts.safeModeRemoving") : $t("prompts.safeModeAdding") }}
      </span>
      <span v-else>
        {{ isRemoving ? $t("prompts.safeModeRemoveAction") : $t("prompts.safeModeAddAction") }}
      </span>
    </button>
  </div>
</template>

<script>
import { mutations } from "@/store";
import { safeModeApi } from "@/api";
import { notify } from "@/notify";

export default {
  name: "SafeMode",
  props: {
    items: {
      type: Array,
      required: true,
    },
    hasPIN: {
      type: Boolean,
      default: false,
    },
    isRemoving: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      pin: "",
      pinConfirm: "",
      errorMessage: "",
      loading: false,
    };
  },
  computed: {
    canSubmit() {
      if (this.pin.length !== 4) return false;
      if (!this.hasPIN && !this.isRemoving) {
        return this.pinConfirm.length === 4;
      }
      return true;
    },
  },
  methods: {
    closeHovers() {
      mutations.closeHovers();
    },
    focusConfirm() {
      if (this.$refs.confirmInput) {
        this.$refs.confirmInput.focus();
      }
    },
    async submit() {
      if (!this.canSubmit || this.loading) return;
      this.errorMessage = "";

      if (!this.hasPIN && !this.isRemoving && this.pin !== this.pinConfirm) {
        this.errorMessage = this.$t("prompts.safeModePINMismatch");
        this.pinConfirm = "";
        if (this.$refs.confirmInput) this.$refs.confirmInput.focus();
        return;
      }

      this.loading = true;
      try {
        let result;
        if (this.isRemoving) {
          result = await safeModeApi.removeFromSafeMode(this.items, this.pin);
        } else {
          result = await safeModeApi.addToSafeMode(this.items, this.pin);
        }
        mutations.setSafeModeItems(result.items);
        if (!this.isRemoving) {
          mutations.setSafeModeUnlocked(true);
        }
        notify.showSuccessToast(
          this.isRemoving
            ? this.$t("prompts.safeModeRemovedSuccess")
            : this.$t("prompts.safeModeAddedSuccess")
        );
        mutations.closeHovers();
      } catch (err) {
        this.errorMessage = err.message || this.$t("prompts.safeModeFailed");
        this.pin = "";
        this.pinConfirm = "";
        if (this.$refs.pinInput) this.$refs.pinInput.focus();
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style scoped>
.safemode-pin-row {
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin-top: 0.75em;
}

.safemode-pin-input {
  /* Wide enough for the longest placeholder. At 0.3em letter-spacing and 1.2em text,
     "Confirm PIN" overflowed 8em and rendered as "Confirm", which read as the wrong
     label rather than as a clipped one. */
  width: 11em;
  letter-spacing: 0.3em;
  text-align: center;
  font-size: 1.2em;

  /* Masked, but not a password field.
     These inputs were type="password", which is what a 4-digit PIN looks like to a
     human and what a *credential* looks like to a password manager. Managers offer to
     save anything in a password field, and a SAFEMode PIN accepted into a synced vault
     is the one secret in this product that must not live anywhere else -- it is what
     stands between someone glancing at this screen and the files that are hidden.
     autocomplete="off" is routinely ignored by managers, so the fix is not to present
     the field as a password at all: mask it in CSS, and mark it for the managers that
     honour opt-out attributes.
     Supported in Chrome, Edge, Safari and Firefox 118+. On anything older the digits
     are visible as typed -- worse for shoulder-surfing, better than the PIN being
     stored -- and the 4-digit value is cleared from memory on submit either way. */
  -webkit-text-security: disc;
  text-security: disc;
}

/* Letter-spacing is for four digits, not for words. Without this the placeholder
   overflows and gets cut off mid-word. */
.safemode-pin-input::placeholder {
  letter-spacing: normal;
  font-size: 0.85em;
}

.safemode-error {
  color: var(--red, #e53935);
  font-size: 0.9em;
  margin-top: 0.5em;
}

.button--red {
  background-color: var(--red, #e53935) !important;
  color: white !important;
}

.safemode-loading-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
}

.spin {
  animation: spin 1s linear infinite;
  font-size: 1em;
}

@keyframes spin {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
