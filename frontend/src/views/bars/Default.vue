<template>
  <header v-if="!isOnlyOffice" :class="['flexbar', { 'dark-mode-header': isDarkMode }]">
    <!-- joliroDrive brand, top-left. The wordmark image reads "joliro"; append "Drive". -->
    <div class="header-brand">
      <img class="header-logo" :src="logoSrc" alt="joliro" />
      <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -->
      <span class="header-brand-suffix">Drive</span>
    </div>
    <action
      v-if="!disableNavButtons"
      icon="close_back"
      :label="$t('general.close')"
      :disabled="isDisabledMultiAction"
      @action="multiAction"
    />
    <search v-if="showSearch" />
    <title v-else class="topTitle" :class="{ 'topTitle--settings': isSettings }">{{ getTopTitle }}</title>
    <div class="header-right">
      <action
        v-if="isListingView && !disableNavButtons"
        class="menu-button"
        :icon="viewIcon"
        :label="$t('buttons.switchView')"
        @action="switchView"
        :disabled="isDisabled"
      />
      <action
        class="overflow-menu-button"
        v-else-if="!isListingView && !showQuickSave && !isSettings"
        :icon="iconName"
        :disabled="noItems"
        @click="toggleOverflow"
      />
      <action
        class="save-button"
        v-else-if="showQuickSave"
        id="save-button"
        icon="save"
        :label="$t('general.save')"
        @action="save()"
      />
      <!-- Privacy Screen button — same format as the other joliro apps (landing page). -->
      <button
        type="button"
        class="privacy-pill"
        :title="$t('buttons.privacyScreen')"
        @click="enablePrivacyScreen"
      >
        <svg class="privacy-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </svg>
        <span>{{ $t('buttons.privacyScreen') }}</span>
      </button>
    </div>
  </header>
</template>

<script>
import router from "@/router";
import buttons from "@/utils/buttons";
import { notify } from "@/notify";
import { getters, state, mutations } from "@/store";
import Action from "@/components/Action.vue";
import Search from "@/components/Search.vue";
import { globalVars } from "@/utils/constants";
import { url } from "@/utils";

export default {
  name: "UnifiedHeader",
  components: {
    Action,
    Search,
  },
  data() {
    return {
      viewModes: ["list", "normal", "icons"],
    };
  },
  computed: {
    getTopTitle() {
      if (getters.isSettings()) {
        return this.$t("general.settings");
      }
      if (getters.isShare()) {
        if (state.shareInfo?.title && state.req.type === "directory") {
          return state.shareInfo?.title;
        }
        return "";
      }
      const currentTool = getters.currentTool();
      if (currentTool) {
        return currentTool.name;
      }
      return state.req.name;
    },
    showQuickSave() {
      if (getters.currentView() != "editor" || !state.user.permissions.modify) {
        return false;
      }
      return state.user.editorQuickSave;
    },
    disableNavButtons() {
      return (globalVars.disableNavButtons && this.isListingView) || (getters.isShare() && state.shareInfo?.hideNavButtons && getters.currentView() == "listingView");
    },
    isOnlyOffice() {
      return getters.currentView() === "onlyOfficeEditor";
    },
    isListingView() {
      return getters.currentView() == "listingView";
    },
    iconName() {
      return getters.currentPromptName() === "OverflowMenu"
        ? "keyboard_arrow_up"
        : "more_vert";
    },
    viewIcon() {
      const icons = {
        list: "view_list",
        compact: "view_list",
        normal: "view_module",
        gallery: "grid_view",
      };
      return icons[getters.viewMode()] || "grid_view";
    },
    logoSrc() {
      return globalVars.baseURL + "public/static/img/icons/joliro-brand.png";
    },
    isShare() {
      return getters.isShare();
    },
    noItems() {
      return !state.contextMenuHasItems;
    },
    showEdit() {
      return window.location.hash != "#edit" && state.user.permissions.modify;
    },
    showDelete() {
      return state.user.permissions.modify && getters.currentView() == "preview";
    },
    showSave() {
      return getters.currentView() == "editor" && state.user.permissions.modify;
    },
    showSearch() {
      return getters.isLoggedIn() && getters.currentView() === "listingView" && !getters.isShare();
    },
    isDisabled() {
      return state.isSearchActive || getters.currentPromptName() != "";
    },
    isDisabledMultiAction() {
      const shareDisabled = state.shareInfo?.disableSidebar && getters.multibuttonState() === "menu";
      return this.isDisabled || (getters.isStickySidebar() && getters.multibuttonState() === "menu") || shareDisabled;
    },
    showSwitchView() {
      return getters.currentView() === "listingView";
    },
    showSidebarToggle() {
      return getters.currentView() === "listingView";
    },
    req() {
      return state.req;
    },
    isDarkMode() {
      return getters.isDarkMode();
    },
    isSettings() {
      return getters.isSettings();
    },
  },
  methods: {
    async save() {
      const button = "save";
      buttons.loading("save");
      try {
        // Call the editor's save handler directly
        if (state.editorSaveHandler) {
          await state.editorSaveHandler();
          buttons.success(button);
          // Note: Success notification is shown by the editor
        } else {
          const errorMsg = "No editor save handler registered";
          notify.showError(errorMsg);
          throw new Error(errorMsg);
        }
      } catch (e) {
        buttons.done(button);
        // Note: Error notification is already shown by the editor
        throw e; // Re-throw so caller knows save failed
      }
    },
    toggleOverflow() {
      if (getters.currentPromptName() === "OverflowMenu") {
        mutations.closeHovers();
      } else {
        mutations.showHover({ name: "OverflowMenu" });
      }
    },
    switchView() {
      mutations.closeHovers();
      const index = this.viewModes.indexOf(getters.viewMode());
      const next = (index + 1) % this.viewModes.length;
      const newViewMode = this.viewModes[next];
      mutations.updateDisplayPreferences({ viewMode: newViewMode });
      mutations.updateCurrentUser({ viewMode: newViewMode });
    },
    enablePrivacyScreen() {
      mutations.closeHovers();
      mutations.setPrivacyScreen(true);
    },
    multiAction() {
      const cv = getters.currentView();

      // Check for unsaved editor changes before navigation
      if (cv === "editor" && state.editorDirty) {
        this.showSaveBeforeExitPrompt(() => this.performNavigation(cv));
        return;
      }

      this.performNavigation(cv);
    },
    performNavigation(cv) {
      if (cv == "listingView" || ( getters.isShare() && !getters.multibuttonState() === "close")) {
        mutations.toggleSidebar();
      } else if (cv == "settings" && state.isMobile) {
        mutations.toggleSidebar();
      } else {
        mutations.closeHovers();
        if (cv === "settings") {
          if (state.previousHistoryItem?.name) {
            url.goToItem(state.previousHistoryItem.source, state.previousHistoryItem.path, state.previousHistoryItem);
            return;
          }
          router.push({ path: "/files" });
          return;
        }
        if (getters.isPreviewView()) {
          if (state.previousHistoryItem?.name) {
            url.goToItem(state.previousHistoryItem.source, state.previousHistoryItem.path, state.previousHistoryItem);
            return;
          } else {
            // navigate to parent directory of current url
            const parentPath = url.removeLastDir(state.route.path);
            router.push({ path: parentPath });
          }
          return;
        }

        router.go(-1);
      }
    },
    showSaveBeforeExitPrompt(onConfirmAction) {
      mutations.showHover({
        name: "SaveBeforeExit",
        confirm: async () => {
          // Save and exit - trigger the save action
          // If save fails, this will throw and be caught by SaveBeforeExit component
          await this.save();
          mutations.setEditorDirty(false);
          onConfirmAction();
        },
        discard: () => {
          // Discard changes and exit
          mutations.setEditorDirty(false);
          onConfirmAction();
        },
        cancel: () => {
          // Keep editing - do nothing
        },
      });
    },
  },
};
</script>

<style scoped>
.topTitle--settings {
  font-size: 1.8em;
  font-weight: 700;
}

/* joliroDrive brand, top-left. */
.header-brand {
  display: flex;
  align-items: center;
  gap: 0.1em;
  flex-shrink: 0;
  margin-right: 0.75em;
}
.header-brand-suffix {
  font-size: 1.25em;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #f4f8f8 !important;
}

/* Right-aligned header cluster: view control + privacy button. */
.header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.5em;
  flex-shrink: 0;
}

/* Privacy Screen button — matches the landing page's white pill exactly.
   Overrides the header's forced light text (header * !important) via .privacy-pill *. */
.privacy-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  height: 2.25em;
  padding: 0 0.75em;
  border-radius: 0.5em;
  font-size: 0.9em;
  font-weight: 500;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background-color 0.15s, color 0.15s;
}
.privacy-pill,
.privacy-pill * {
  color: #6b7280 !important;
}
.privacy-pill:hover {
  background: #f9fafb;
}
.privacy-pill:hover,
.privacy-pill:hover * {
  color: #374151 !important;
}
.privacy-pill-icon {
  width: 1em;
  height: 1em;
  flex-shrink: 0;
}

/* joliroDrive wordmark, knocked out to white to read on the teal header. */
.header-logo {
  height: 1.8em;
  width: auto;
  object-fit: contain;
  filter: brightness(0) invert(1);
}

:deep(button:has(#button-toggle-navbar)) {
  display: none;
}

header button:hover {
  box-shadow: unset !important;
  -webkit-box-shadow: unset !important;
}
header {
  background-color: #3a7d82 !important;
  color: #f4f8f8 !important;
}
/* Ensure all header text and icons are light colored */
header, header *, header .action, header .action i, header title {
  color: #f4f8f8 !important;
}
/* Header with backdrop-filter support */
@supports (backdrop-filter: none) {
  header {
    backdrop-filter: none;
  }
  .dark-mode-header {
    background-color: rgb(37 49 55 / 33%) !important;
  }
}
</style>