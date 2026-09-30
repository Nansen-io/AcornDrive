<template>
  <div class="card-title">
    <h2>{{ $t("prompts.upload") }}</h2>
  </div>

  <div class="upload-drop-zone" :class="{ dropping: isDragging }" @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
    <div v-if="files.length === 0" class="drop-hint">
      <i class="material-icons">cloud_upload</i>
      <div class="browse-buttons">
        <button @click="openFilePicker" class="button button--flat browse-primary"
          :aria-label="$t('buttons.uploadFiles')" :title="$t('buttons.uploadFiles')">
          <i class="material-icons">insert_drive_file</i>
          {{ $t("buttons.uploadFiles") }}
        </button>
        <button @click="openFolderPicker" class="button button--flat"
          :aria-label="$t('buttons.uploadFolder')" :title="$t('buttons.uploadFolder')">
          <i class="material-icons">folder</i>
          {{ $t("buttons.uploadFolder") }}
        </button>
      </div>
      <p>{{ $t("prompts.dragAndDrop") }}</p>
    </div>
    <div v-if="showConflictPrompt" class="conflict-overlay">
      <div class="card">
        <div class="card-content">
          <p>{{ $t("prompts.conflictsDetected") }}</p>
        </div>
        <div class="card-actions">
          <button @click="resolveConflict(false)" class="button button--flat button--grey">
            {{ $t("general.cancel") }}
          </button>
          <button @click="resolveConflict(true)" class="button button--flat button--red">
            {{ $t("general.replace") }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="files.length > 0" class="upload-list">
      <div v-for="file in files" :key="file.id" class="upload-item">
        <i class="material-icons file-icon">{{ file.type === "directory" ? "folder" : "insert_drive_file" }}</i> <!-- eslint-disable-line @intlify/vue-i18n/no-raw-text -->
        <div class="file-info">
          <div class="progress-with-name">
            <span class="bar-filename">{{ file.name }}</span>
            <progress-bar v-if="file.type !== 'directory'" :val="file.status === 'completed'
                ? ''
                : file.status === 'error'
                  ? $t('prompts.error')
                  : file.status === 'conflict'
                    ? $t('prompts.conflictsDetected')
                    : (file.progress / 100) * file.size
              " :unit="file.status === 'completed' || file.status === 'error' ? '' : 'bytes'" :max="file.size"
              :status="file.status" text-position="inside" size="29" text-align="right"
              :help-text="file.status === 'error' && file.errorDetails ? file.errorDetails : ''">
            </progress-bar>
            <div v-if="file.type === 'directory'" class="dir-status-bar">
              <span class="bar-status-text">{{ getStatusText(file.status) }}</span>
            </div>
          </div>
        </div>
        <div class="file-actions">
          <button v-if="file.status === 'uploading'" @click="uploadManager.pause(file.id)" class="action"
            :aria-label="$t('general.pause')" :title="$t('general.pause')">
            <i class="material-icons">pause</i>
          </button>
          <button v-if="file.status === 'paused'" @click="uploadManager.resume(file.id)" class="action"
            :aria-label="$t('general.resume')" :title="$t('general.resume')">
            <i class="material-icons">play_arrow</i>
          </button>
          <button v-if="file.status === 'error'" @click="uploadManager.retry(file.id)" class="action"
            :aria-label="$t('general.retry')" :title="$t('general.retry')">
            <i class="material-icons">replay</i>
          </button>
          <button v-if="file.status === 'conflict'" @click="handleConflictAction(file)" class="action"
            :aria-label="$t('general.replace')" :title="$t('general.replace')">
            <i class="material-icons">sync_problem</i>
          </button>
          <button @click="cancelUpload(file.id)" class="action" :aria-label="$t('general.cancel')"
            :title="$t('general.cancel')">
            <i class="material-icons">close</i>
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="card-actions">
    <button @click="clearCompleted" class="button button--flat" :disabled="!hasCompleted"
      :aria-label="$t('buttons.clearCompleted')" :title="$t('buttons.clearCompleted')">
      {{ $t("buttons.clearCompleted") }}
    </button>
    <button v-if="files.length > 0" @click="openFilePicker" class="button button--flat"
      :aria-label="$t('buttons.uploadFiles')" :title="$t('buttons.uploadFiles')">
      {{ $t("buttons.uploadFiles") }}
    </button>
    <div class="spacer"></div>
    <button v-if="canPauseAll" @click="uploadManager.pauseAll" class="button button--flat"
      :aria-label="$t('buttons.pauseAll')" :title="$t('buttons.pauseAll')">
      {{ $t("buttons.pauseAll") }}
    </button>
    <button v-if="canResumeAll" @click="uploadManager.resumeAll" class="button button--flat"
      :aria-label="$t('buttons.resumeAll')" :title="$t('buttons.resumeAll')">
      {{ $t("buttons.resumeAll") }}
    </button>
    <button v-if="shareInfo.shareType !== 'upload'" @click="close" class="button button--flat button--grey"
      :aria-label="$t('general.cancel')" :title="$t('general.cancel')">
      {{ $t("general.close") }}
    </button>
  </div>

  <input ref="fileInput" @change="onFilePicked" type="file" multiple style="display: none" />
  <input ref="folderInput" @change="onFolderPicked" type="file" webkitdirectory directory multiple
    style="display: none" />
</template>

<script>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { uploadManager } from "@/utils/upload";
import { mutations, state } from "@/store";
import { notify } from "@/notify";
import ProgressBar from "@/components/ProgressBar.vue";
import i18n from "@/i18n";

export default {
  name: "UploadFiles",
  components: {
    ProgressBar,
  },
  props: {
    initialItems: {
      type: Object,
      default: null,
    },
    filesToReplace: {
      type: Array,
      default: () => [],
    },
  },
  computed: {
    shareInfo() {
      return state.shareInfo;
    },
  },
  setup(props) {
    const fileInput = ref(null);
    const folderInput = ref(null);
    const files = computed(() => uploadManager.queue);
    const isDragging = ref(false);
    const showConflictPrompt = ref(false);
    let conflictResolver = null;

    let wakeLock = null;

    const handleConflict = (resolver) => {
      conflictResolver = resolver;
      mutations.showHover({
        name: "replace-rename",
        confirm: (event, option) => {
          if (option === "overwrite") {
            resolveConflict(true);
          } else if (option === "rename") {
            showRenamePrompt();
          } else {
            resolveConflict(false);
          }
        },
      });
    };

    const resolveConflict = (overwrite) => {
      if (conflictResolver) {
        conflictResolver(overwrite);
      }
      mutations.closeTopHover();
    };

    const showRenamePrompt = () => {
      mutations.closeTopHover();
      const conflictingFolder = uploadManager.getConflictingFolder();
      if (!conflictingFolder) {
        console.error("No conflicting folder found for rename");
        return;
      }

      mutations.showHover({
        name: "rename",
        confirm: (newName) => {
          renameUploadFolder(conflictingFolder, newName);
        },
        props: { folderName: conflictingFolder }
      });
    };

    const renameUploadFolder = async (oldName, newName) => {
      try {
        const existingItems = new Set(state.req.items.map(i => i.name));
        if (existingItems.has(newName)) {
          notify.showError(new Error(`A folder named "${newName}" already exists`));
          return;
        }
        await uploadManager.renameFolder(oldName, newName);
        if (conflictResolver) {
          conflictResolver({ rename: newName });
        }
        mutations.closeTopHover();
      } catch (error) {
        console.error(error);
      }
    };

    const acquireWakeLock = async () => {
      if (!("wakeLock" in navigator)) return;
      try {
        if (wakeLock !== null) return;
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } catch (err) {
        console.error(`Wake Lock failed: ${err.name}, ${err.message}`);
      }
    };

    const releaseWakeLock = () => {
      if (wakeLock !== null) {
        wakeLock.release();
        wakeLock = null;
      }
    };

    const isUploading = computed(() => state.upload.isUploading);

    watch(isUploading, (active) => {
      if (active) acquireWakeLock();
      else releaseWakeLock();
    });

    const hasCompleted = computed(() =>
      files.value.some((file) => file.status === "completed")
    );

    const canPauseAll = computed(() =>
      files.value.some((file) => file.status === "uploading")
    );

    const canResumeAll = computed(
      () => !canPauseAll.value && files.value.some((file) => file.status === "paused")
    );

    const close = () => {
      mutations.closeHovers();
    };

    const clearCompleted = () => {
      uploadManager.clearCompleted();
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && isUploading.value) {
        acquireWakeLock();
      }
    };

    const handleBeforeUnload = (event) => {
      if (isUploading.value) {
        event.preventDefault();
        event.returnValue = '';
        return '';
      }
    };

    const processItems = async (items) => {
      if (Array.isArray(items)) {
        if (items.length > 0 && items[0] instanceof File) {
          processFileList(items);
        } else {
          await processDroppedItems(items);
        }
      } else if (items) {
        await processDroppedItems(Array.from(items));
      }
    };

    onMounted(async () => {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("beforeunload", handleBeforeUnload);
      uploadManager.setOnConflict(handleConflict);
      if (props.initialItems) {
        // Opened by dropping files onto the folder: upload what was dropped.
        await processItems(props.initialItems);
      } else if (!isUploading.value && state.shareInfo?.shareType !== "upload") {
        // Opened from the Upload menu: go straight to the file browser. This runs in the same
        // user click that opened the dialog, so the browser allows the picker to open.
        openFilePicker();
      }
    });

    onUnmounted(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      uploadManager.setOnConflict(() => {});
      releaseWakeLock();
    });

    const openFilePicker = () => {
      if (fileInput.value) fileInput.value.click();
    };

    const openFolderPicker = () => {
      if (folderInput.value) folderInput.value.click();
    };

    const onFilePicked = (event) => {
      const pickedFiles = event.target.files;
      if (pickedFiles.length > 0) processFileList(pickedFiles);
      if (event.target) event.target.value = null;
    };

    const onFolderPicked = (event) => {
      const pickedFiles = event.target.files;
      if (pickedFiles.length > 0) processFileList(pickedFiles);
      if (event.target) event.target.value = null;
    };

    const onDrop = async (event) => {
      isDragging.value = false;
      if (event.dataTransfer.items) {
        const items = Array.from(event.dataTransfer.items);
        await processDroppedItems(items);
      } else {
        processFileList(event.dataTransfer.files);
      }
    };

    const onDragEnter = () => { isDragging.value = true; };
    const onDragOver = () => { isDragging.value = true; };
    const onDragLeave = () => { isDragging.value = false; };

    const getFilesFromDirectoryEntry = async (entry) => {
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file((file) => {
            const relativePath = entry.fullPath.startsWith("/")
              ? entry.fullPath.substring(1)
              : entry.fullPath;
            resolve([{ file, relativePath }]);
          });
        });
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const entries = await new Promise((resolve) => {
          reader.readEntries((e) => resolve(e));
        });
        const allFiles = await Promise.all(
          entries.map((subEntry) => getFilesFromDirectoryEntry(subEntry))
        );
        return allFiles.flat();
      }
      return [];
    };

    const processDroppedItems = async (items) => {
      const filesToUpload = [];
      const promises = items.map(item => {
        const entry = item.webkitGetAsEntry();
        if (entry) return getFilesFromDirectoryEntry(entry);
        return Promise.resolve([]);
      });
      const allFiles = await Promise.all(promises);
      allFiles.forEach(files => filesToUpload.push(...files));
      if (filesToUpload.length > 0) {
        uploadManager.add(state.req.path, filesToUpload);
      }
    };

    const processFileList = (fileList) => {
      const filesToAdd = Array.from(fileList).map((file) => ({
        file,
        relativePath: file.webkitRelativePath || file.name,
      }));
      if (filesToAdd.length > 0) {
        uploadManager.add(state.req.path, filesToAdd);
      }
    };

    const handleConflictAction = (file) => {
      mutations.showHover({
        name: "replace",
        confirm: () => {
          uploadManager.retry(file.id, true);
          mutations.closeTopHover();
        },
      });
    };

    const cancelUpload = (id) => {
      uploadManager.cancel(id);
    };

    const getStatusText = (status) => {
      switch (status) {
        case 'uploading': return i18n.global.t('general.uploading', { suffix: '...' });
        case 'completed': return i18n.global.t('prompts.completed');
        case 'error': return i18n.global.t('prompts.error');
        case 'paused': return i18n.global.t('general.paused');
        case 'conflict': return i18n.global.t('general.conflict');
        default: return status;
      }
    };

    return {
      fileInput,
      folderInput,
      openFilePicker,
      openFolderPicker,
      onFilePicked,
      onFolderPicked,
      files,
      isDragging,
      onDragEnter,
      onDragLeave,
      onDragOver,
      onDrop,
      cancelUpload,
      uploadManager,
      close,
      clearCompleted,
      hasCompleted,
      showConflictPrompt,
      resolveConflict,
      showRenamePrompt,
      renameUploadFolder,
      canPauseAll,
      canResumeAll,
      handleConflictAction,
      getStatusText,
    };
  },
};
</script>

<style scoped>
.upload-drop-zone {
  margin: 0 1em 0.5em;
  border: 2px dashed rgba(128, 128, 128, 0.3);
  border-radius: 10px;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.2s, transform 0.2s;
  position: relative;
  overflow: hidden;
}

.dropping {
  transform: scale(0.98);
  box-shadow: var(--primaryColor) 0 0 1em;
  border-color: var(--primaryColor);
}

.drop-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 2.5em 1em;
  color: #aaa;
}

.drop-hint i {
  font-size: 3em;
  margin-bottom: 0.3em;
  opacity: 0.5;
}

.drop-hint p {
  margin: 0;
  font-size: 0.9em;
  opacity: 0.7;
}

.browse-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5em;
  margin-bottom: 0.8em;
}

.browse-buttons .button {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
}

.browse-buttons .button i {
  font-size: 1.2em;
  margin: 0;
  opacity: 1;
}

.browse-buttons .browse-primary {
  background: var(--primaryColor);
  color: #fff;
}

.upload-list {
  overflow-y: auto;
  padding: 0.5em;
  flex: 1;
  display: flex;
  flex-direction: column-reverse;
  min-height: 0;
}

.upload-item {
  display: flex;
  align-items: center;
  padding: 0.5em 0.4em;
  border-radius: 6px;
  gap: 0.5em;
}

.upload-item:not(:last-child) {
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}

.file-icon {
  color: #aaa;
  font-size: 1.3em;
  flex-shrink: 0;
}

.file-info {
  flex-grow: 1;
  min-width: 0;
}

.progress-with-name {
  position: relative;
}

.bar-filename {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  font-size: 0.78em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  padding: 0 0.5em;
  pointer-events: none;
  font-weight: 500;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

.dir-status-bar {
  display: flex;
  align-items: center;
  height: 24px;
  background: #eee;
  border-radius: 8px;
  padding: 0 0.5em;
  position: relative;
}

.bar-status-text {
  position: absolute;
  right: 0.5em;
  font-size: 0.78em;
  color: #666;
}

.file-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.file-actions .action {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.2em;
  color: #888;
  border-radius: 4px;
  transition: color 0.15s;
}

.file-actions .action:hover {
  color: var(--primaryColor);
}

.file-actions .action i {
  font-size: 1.1em;
}

.conflict-overlay {
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.7);
  z-index: 999;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 10px;
}

.conflict-overlay .card {
  background-color: var(--card-background-color);
  padding: 1em;
  border-radius: 8px;
}

.card-actions {
  display: flex;
  align-items: center;
  padding: 0.5em 1em;
  gap: 0.5em;
}

.spacer {
  flex-grow: 1;
}
</style>
