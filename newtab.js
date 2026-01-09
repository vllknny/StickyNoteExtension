document.addEventListener("DOMContentLoaded", () => {

  /* ======================================================
     DOM ELEMENTS (ALWAYS FIRST)
  ====================================================== */

  const editor = document.getElementById("editor");
  const list = document.getElementById("note-list");
  const search = document.getElementById("search");
  const exportBtn = document.getElementById("export");
  const grid = document.getElementById("wallpaper-grid");
  const slideshowBtn = document.getElementById("slideshow-toggle");
  const connectVaultBtn = document.getElementById("connect-vault");

  if (!editor || !list) {
    console.error("Critical UI missing — aborting init");
    return;
  }

  const hasWallpaperUI = Boolean(grid && slideshowBtn);

  /* ======================================================
     WALLPAPERS
  ====================================================== */

  const wallpaperFiles = ["bg1.jpg", "bg2.jpg", "bg3.jpg"];
  const wallpapers = wallpaperFiles.map(f =>
    chrome.runtime.getURL(`wallpapers/${f}`)
  );

  let wallpaperIndex = 0;
  let wallpaperMode = "slideshow";
  let slideshowInterval = null;

  function applyWallpaper(url) {
    document.body.style.backgroundImage = `url(${url})`;
  }

  function startSlideshow() {
    stopSlideshow();
    applyWallpaper(wallpapers[wallpaperIndex]);

    slideshowInterval = setInterval(() => {
      wallpaperIndex = (wallpaperIndex + 1) % wallpapers.length;
      applyWallpaper(wallpapers[wallpaperIndex]);
      saveWallpaperState();
    }, 15000);
  }

  function stopSlideshow() {
    if (slideshowInterval) {
      clearInterval(slideshowInterval);
      slideshowInterval = null;
    }
  }

  function saveWallpaperState() {
    chrome.storage.local.set({ wallpaperIndex, wallpaperMode });
  }

  // Preload images
  wallpapers.forEach(src => {
    const img = new Image();
    img.src = src;
  });

  /* ======================================================
     NOTES
  ====================================================== */

  let notes = {};
  let activeNoteId = null;

  const todayId = () =>
    `Daily/${new Date().toISOString().slice(0, 10)}`;

  function saveNotes() {
    chrome.storage.local.set({ notes, activeNoteId });
  }

  function renderList(filter = "") {
    list.innerHTML = "";

    Object.keys(notes)
      .filter(id =>
        notes[id].content.toLowerCase().includes(filter)
      )
      .forEach(id => {
        const li = document.createElement("li");
        li.textContent = id;
        li.onclick = () => loadNote(id);
        list.appendChild(li);
      });
  }

  function loadNote(id) {
    activeNoteId = id;

    const note = notes[id] || { content: "", cursor: 0 };
    notes[id] = note;

    editor.value = note.content;
    editor.focus();

    const pos = note.cursor ?? editor.value.length;
    requestAnimationFrame(() =>
      editor.setSelectionRange(pos, pos)
    );

    saveNotes();
  }

  /* ======================================================
     OBSIDIAN VAULT SYNC
  ====================================================== */

  let vaultHandle = null;

  async function connectVault() {
    try {
      vaultHandle = await window.showDirectoryPicker({
        mode: "readwrite"
      });
      alert(`Connected to vault: ${vaultHandle.name}`);
    } catch {
      console.warn("Vault connection cancelled");
    }
  }

  async function writeToVault(filename, content) {
    if (!vaultHandle) return;

    const fileHandle = await vaultHandle.getFileHandle(
      `${filename}.md`,
      { create: true }
    );

    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  if (connectVaultBtn) {
    connectVaultBtn.onclick = connectVault;
  }

  /* ======================================================
     LOAD STORED STATE
  ====================================================== */

  chrome.storage.local.get(
    ["notes", "activeNoteId", "wallpaperIndex", "wallpaperMode"],
    data => {
      notes = data.notes || {};
      activeNoteId = data.activeNoteId || todayId();

      if (!notes[activeNoteId]) {
        notes[activeNoteId] = { content: "", cursor: 0 };
      }

      wallpaperIndex = data.wallpaperIndex ?? 0;
      wallpaperMode = data.wallpaperMode ?? "slideshow";

      renderList();
      loadNote(activeNoteId);

      if (wallpaperMode === "slideshow") {
        startSlideshow();
      } else {
        applyWallpaper(wallpapers[wallpaperIndex]);
      }

      if (hasWallpaperUI) {
        updateActiveThumb();
      }
    }
  );

  /* ======================================================
     EVENTS
  ====================================================== */

  editor.addEventListener("input", async () => {
    const note = notes[activeNoteId];
    note.content = editor.value;
    note.cursor = editor.selectionStart;

    saveNotes();

    if (vaultHandle) {
      await writeToVault(activeNoteId, note.content);
    }
  });

  if (search) {
    search.addEventListener("input", e => {
      renderList(e.target.value.toLowerCase());
    });
  }

  if (exportBtn) {
    exportBtn.onclick = () => {
      const blob = new Blob(
        [notes[activeNoteId].content],
        { type: "text/markdown" }
      );

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${activeNoteId}.md`;
      a.click();
    };
  }

  /* ======================================================
     WALLPAPER UI (GUARDED)
  ====================================================== */

  function updateActiveThumb() {
    [...grid.children].forEach((el, i) => {
      el.classList.toggle("active", i === wallpaperIndex);
    });
  }

  if (hasWallpaperUI) {
    wallpapers.forEach((url, index) => {
      const div = document.createElement("div");
      div.className = "wallpaper-thumb";
      div.style.backgroundImage = `url(${url})`;

      div.onclick = () => {
        wallpaperIndex = index;
        wallpaperMode = "static";
        stopSlideshow();
        applyWallpaper(url);
        saveWallpaperState();
        updateActiveThumb();
      };

      grid.appendChild(div);
    });

    slideshowBtn.onclick = () => {
      wallpaperMode = "slideshow";
      startSlideshow();
      saveWallpaperState();
    };
  }

  /* ======================================================
     MARKDOWN SLASH COMMANDS
  ====================================================== */

  function replaceLine(text) {
    const start =
      editor.value.lastIndexOf("\n", editor.selectionStart - 1) + 1;

    const end = editor.selectionStart;

    editor.value =
      editor.value.slice(0, start) +
      text +
      editor.value.slice(end);

    editor.setSelectionRange(
      start + text.length,
      start + text.length
    );
  }

  editor.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;

    const lineStart =
      editor.value.lastIndexOf("\n", editor.selectionStart - 1) + 1;

    const line = editor.value
      .slice(lineStart, editor.selectionStart)
      .trim();

    if (!line.startsWith("/")) return;

    e.preventDefault();

    switch (line) {
      case "/todo":
        replaceLine("- [ ] ");
        break;
      case "/date":
        replaceLine(new Date().toLocaleDateString());
        break;
      case "/heading":
        replaceLine("## ");
        break;
      case "/code":
        replaceLine("```js\n\n```");
        break;
    }
  });

});
