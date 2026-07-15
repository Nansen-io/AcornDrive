<template>
  <div >
    <div v-show="showOverlay" @contextmenu.prevent="onOverlayRightClick" @click="resetPrompts" class="overlay"></div>
    <div v-if="progress" class="progress">
      <div v-bind:style="{ width: this.progress + '%' }"></div>
    </div>
    <defaultBar :class="{ 'dark-mode-header': isDarkMode }"></defaultBar>
    <sidebar></sidebar>
    <Scrollbar id="main" :class="{
      'dark-mode': isDarkMode,
      moveWithSidebar: moveWithSidebar,
      'remove-padding-top': isOnlyOffice,
      'main-padding': showPadding,
      scrollable: scrollable,
    }">
      <router-view />
    </Scrollbar>
    <prompts :class="{ 'dark-mode': isDarkMode }"></prompts>
  </div>
  <Notifications />
  <Toast :toasts="toasts" />
  <transition name="welcome-fade">
    <div v-if="showWelcome" class="welcome-banner"><!-- eslint-disable-line @intlify/vue-i18n/no-raw-text -->
      Welcome back, {{ welcomeName }}<!-- eslint-disable-line @intlify/vue-i18n/no-raw-text -->
    </div>
  </transition>
  <StatusBar :class="{ moveWithSidebar: moveWithSidebar }" />
  <ContextMenu v-if="showContextMenu"></ContextMenu>
  <Tooltip />
  <NextPrevious />
  <PopupPreview v-if="popupEnabled" />
</template>

<script>
import defaultBar from "./bars/Default.vue";
import Prompts from "@/components/prompts/Prompts.vue";
import Sidebar from "@/components/sidebar/Sidebar.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import Notifications from "@/components/Notifications.vue";
import Toast from "@/components/Toast.vue";
import StatusBar from "@/components/StatusBar.vue";
import Scrollbar from "@/components/files/Scrollbar.vue";
import Tooltip from "@/components/Tooltip.vue";
import NextPrevious from "@/components/files/nextPrevious.vue";
import PopupPreview from "@/components/files/PopupPreview.vue";
import { filesApi } from "@/api";
import { state, getters, mutations } from "@/store";
import { events, notify } from "@/notify";
import { generateRandomCode } from "@/utils/auth";

export default {
  name: "layout",
  components: {
    ContextMenu,
    Notifications,
    Toast,
    StatusBar,
    defaultBar,
    Sidebar,
    Prompts,
    Scrollbar,
    Tooltip,
    NextPrevious,
    PopupPreview,
  },
  data() {
    return {
      showContexts: true,
      dragCounter: 0,
      width: window.innerWidth,
      itemWeight: 0,
      toasts: [],
      showWelcome: false,
    };
  },
  mounted() {
    window.addEventListener("resize", this.updateIsMobile);
    document.body.classList.toggle("dark-mode", getters.isDarkMode());
    this.applyIconColors(getters.isDarkMode());
    if (getters.eventTheme() == "halloween") {
      document.documentElement.style.setProperty("--primaryColor", "var(--icon-orange)");
    } else if (state.user.themeColor) {
      document.documentElement.style.setProperty("--primaryColor", state.user.themeColor);
    }
    if (!state.sessionId) {
      mutations.setSession(generateRandomCode(8));
    }
    // Set up toast callback
    notify.setToastUpdateCallback((toasts) => {
      this.toasts = toasts;
    });
    this.reEval()
    this.initialize();
    // Show welcome banner once user data is available
    this._welcomeCheck = setInterval(() => {
      if (this.welcomeName) {
        clearInterval(this._welcomeCheck);
        this.showWelcome = true;
        setTimeout(() => { this.showWelcome = false; }, 5000);
      }
    }, 200);
  },
  computed: {
    isOnlyOffice() {
      return getters.currentView() === "onlyOfficeEditor";
    },
    scrollable() {
      return getters.isScrollable();
    },
    showPadding() {
      return getters.showBreadCrumbs() || getters.currentView() === "settings";
    },
    isLoggedIn() {
      return getters.isLoggedIn();
    },
    welcomeName() {
      const user = state.user;
      if (!user || !user.username) return '';
      if (user.displayName) return user.displayName;
      // Derive first name from email or username
      const localPart = user.username.includes('@') ? user.username.split('@')[0] : user.username;
      const firstName = localPart.split(/[.\-_]/)[0];
      return firstName.charAt(0).toUpperCase() + firstName.slice(1);
    },
    moveWithSidebar() {
      return getters.isSidebarVisible() && getters.isStickySidebar();
    },
    progress() {
      return getters.progress(); // Access getter directly from the store
    },
    currentPrompt() {
      return getters.currentPrompt(); // Access getter directly from the store
    },
    currentPromptName() {
      return getters.currentPromptName(); // Access getter directly from the store
    },
    req() {
      return state.req; // Access state directly from the store
    },
    user() {
      return state.user; // Access state directly from the store
    },
    showOverlay() {
      return getters.showOverlay();
    },
    isDarkMode() {
      return getters.isDarkMode();
    },
    currentView() {
      return getters.currentView();
    },
    showContextMenu() {
      // for now lets disable for tools view
      return getters.currentView() != "tools"
    },
    popupEnabled() {
      if (!state.user || state.user?.username == "") {
        return false;
      }
      return getters.previewPerms().popup;
    },
  },
  watch: {
    isDarkMode(val) {
      document.body.classList.toggle("dark-mode", val);
      this.applyIconColors(val);
    },
    $route() {
      this.reEval()
    },
    'user.loginMethod': {
      handler() {
        this.checkChainFSSubscription();
      },
      immediate: true,
    },
  },
  beforeUnmount() {
    clearInterval(this._welcomeCheck);
  },
  methods: {
    reEval() {
      mutations.setPreviewSource("");
      if (!getters.isLoggedIn()) {
        return;
      }
      const currentView = getters.currentView()
      mutations.setMultiple(false);
      const currentPrompt = getters.currentPromptName();
      if (currentPrompt !== "success" && currentPrompt !== "generic") {
        mutations.closeHovers();
      }
      if (window.location.hash == "" && currentView == "listingView") {
        const element = document.getElementById("main");
        if (element) {
          element.scrollTop = 0;
        }
      }
    },
    async initialize() {
      if (getters.isLoggedIn()) {
        const sourceinfo = await filesApi.sources();
        mutations.updateSourceInfo(sourceinfo);
        if (state.user.permissions.realtime) {
          events.startSSE();
        }
        const maxUploads = state.user.fileLoading?.maxConcurrentUpload || 0;
        if (maxUploads > 10 || maxUploads < 1) {
          mutations.setMaxConcurrentUpload(1);
        }
        if ( state.user.showFirstLogin) {
          mutations.showHover({
            name: "generic",
            props: {
              title: this.$t("prompts.firstLoadTitle"),
              body: this.$t("prompts.firstLoadBody"),
              buttons: [
                {
                  label: this.$t("general.close"),
                  action: () => {
                    mutations.updateCurrentUser({
                      showFirstLogin: false,
                    });
                  },
                },
              ],
            },
          });
        }
        this.checkChainFSSubscription();
      }
    },
    checkChainFSSubscription() {
      if (getters.isShare()) return;
      const user = state.user;
      if (!user || user.loginMethod !== 'chainfs') return;
      if (user.chainfsSubscribed) return;
      /* eslint-disable @intlify/vue-i18n/no-raw-text */
      mutations.showHover({
        name: "generic",
        props: {
          title: "Subscription Required",
          body: `<div style="text-align:center;padding:0.5em 0">
            <p style="margin-bottom:1em">Your joliroAI account does not have an active <strong>Complete</strong> subscription, which is required to protect and store files on ChainFS.</p>
            <a href="https://acorn.tools" target="_blank" rel="noopener noreferrer" class="button button--block" style="display:inline-block;max-width:16em">
              Upgrade at acorn.tools
            </a>
          </div>`,
          buttons: [{ label: "Close" }],
        },
      });
      /* eslint-enable @intlify/vue-i18n/no-raw-text */
    },
    applyIconColors(dark) {
      if (dark) {
        document.documentElement.style.setProperty("--iconBackground", "#1e1f20");
        document.documentElement.style.setProperty("--iconBackgroundHover", "#3A4147");
      } else {
        document.documentElement.style.setProperty("--iconBackground", "#e6f4f5");
        document.documentElement.style.setProperty("--iconBackgroundHover", "#c2e4e6");
      }
    },
    updateIsMobile() {
      mutations.setMobile();
    },
    resetPrompts() {
      mutations.closeSidebar();
      mutations.closeHovers();
      mutations.setSearch(false);
    },
  },
};
</script>

<style>
.welcome-banner {
  position: fixed;
  bottom: 1.5em;
  left: 1em;
  background: #ffffff;
  color: var(--primaryColor);
  padding: 0.6em 1.2em;
  border-radius: 99px;
  font-size: 0.95em;
  font-weight: 600;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  z-index: 9999;
  pointer-events: none;
}

.welcome-fade-enter-active,
.welcome-fade-leave-active {
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.welcome-fade-enter-from,
.welcome-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

.scrollable {
  overflow: scroll !important;
  -webkit-overflow-scrolling: touch;
  /* Enable momentum scrolling in iOS */
}

.remove-padding-top {
  padding-top: 0 !important;
}

#main {
  overflow: unset;
  -ms-overflow-style: none;
  /* Internet Explorer 10+ */
  scrollbar-width: none;
  /* Firefox */
  transition: 0.5s ease;
}

#main.moveWithSidebar {
  padding-left: 20em;
}

#main::-webkit-scrollbar {
  display: none;
  /* Safari and Chrome */
}
#main>div {
  height: 100%;
}
</style>
