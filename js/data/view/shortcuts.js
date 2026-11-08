/**
 * js/data/view/shortcuts.js - Workstation keyboard navigation and shortcut coordinator.
 */
(function(window) {
  function isInputActive(e) {
    const t = e.target;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function adjustVolume(delta) {
    const slider = document.getElementById('volSlider');
    if (!slider) return;
    const cur = parseFloat(slider.value);
    const target = Math.max(0, Math.min(1, Math.round((cur + delta) * 100) / 100));
    slider.value = target;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function seekRelative(seconds) {
    if (!window.XMAudio) return;
    const dur = window.XMAudio.getDuration();
    const cur = window.XMAudio.getPosition();
    const maxTime = dur > 0 ? dur : Infinity;
    const target = Math.max(0, Math.min(maxTime, cur + seconds));
    window.XMAudio.seekTo(target);
  }

  function cyclePlaybackMode() {
    if (!window.XMQueue) return;
    const modes = ['next', 'repeat', 'shuffle', 'stop'];
    const cur = window.XMQueue.playMode;
    const nextIdx = (modes.indexOf(cur) + 1) % modes.length;
    window.XMQueue.setPlayMode(modes[nextIdx]);
  }

  function openHelpModal() {
    const backdrop = document.getElementById('studioModalBackdrop');
    const title = document.getElementById('studioModalTitle');
    const body = document.getElementById('studioModalBody');
    const footer = document.getElementById('studioModalFooter');
    if (!backdrop || !title || !body || !footer) return;

    title.textContent = 'KEYBOARD SHORTCUTS';
    body.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:7px;padding:4px 0;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Play / Pause</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--accent);font-weight:700;">Space / K</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Seek Backward / Forward (5s)</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--accent);font-weight:700;">← / →</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Volume Up / Down (5%)</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--col-gold);font-weight:700;">↑ / ↓</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Next Track</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--col-purple);font-weight:700;">Shift + → / N / ]</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Previous Track</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--col-purple);font-weight:700;">Shift + ← / P / [</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Mute / Unmute</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--accent);font-weight:700;">M</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Favorite Track</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--col-gold);font-weight:700;">F</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Random Track</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--text-primary);font-weight:700;">R</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Cycle Mode (Next, Loop, Rand, Stop)</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--col-rose);font-weight:700;">S</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Focus Archive Search</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--text-primary);font-weight:700;">/</span></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;"><span style="font-size:0.78rem;color:var(--text-secondary);">Close Modal / Cancel</span><span style="font-family:var(--font-mono);font-size:0.70rem;color:var(--text-tertiary);font-weight:700;">Esc</span></div>' +
      '</div>';

    footer.innerHTML = '<button class="action-btn" id="btnShortcutsDone" style="padding:7px 18px;"><span>Done</span></button>';
    backdrop.classList.remove('hide');
    const doneBtn = document.getElementById('btnShortcutsDone');
    if (doneBtn) doneBtn.onclick = () => backdrop.classList.add('hide');
  }

  function handleKeyDown(e) {
    const isInput = isInputActive(e);

    if (e.key === 'Escape') {
      const backdrop = document.getElementById('studioModalBackdrop');
      if (backdrop && !backdrop.classList.contains('hide')) {
        backdrop.classList.add('hide');
        return;
      }
      if (isInput && e.target && typeof e.target.blur === 'function') {
        e.target.blur();
        return;
      }
      return;
    }

    if (isInput) return;

    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      openHelpModal();
      return;
    }

    if (e.key === '/') {
      const search = document.getElementById('leftSearchInput');
      if (search) {
        e.preventDefault();
        search.focus();
        search.select();
      }
      return;
    }

    if (e.code === 'Space' || e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      if (window.XMAudio) window.XMAudio.togglePlayPause();
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
        if (window.XMAudio) window.XMAudio.playNextTrack(true);
      } else {
        seekRelative(5);
      }
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
        if (window.XMAudio) window.XMAudio.playPrevTrack();
      } else {
        seekRelative(-5);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      adjustVolume(0.05);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      adjustVolume(-0.05);
      return;
    }

    if (e.key === 'n' || e.key === 'N' || e.key === ']') {
      e.preventDefault();
      if (window.XMAudio) window.XMAudio.playNextTrack(true);
      return;
    }

    if (e.key === 'p' || e.key === 'P' || e.key === '[') {
      e.preventDefault();
      if (window.XMAudio) window.XMAudio.playPrevTrack();
      return;
    }

    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      const muteBtn = document.getElementById('btnMute');
      if (muteBtn) muteBtn.click();
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      const favBtn = document.getElementById('btnDeckFav');
      if (favBtn && !favBtn.disabled) favBtn.click();
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      const randBtn = document.getElementById('btnPlayRandom');
      if (randBtn) randBtn.click();
      return;
    }

    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      cyclePlaybackMode();
      return;
    }

    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      if (window.XMQueue) window.XMQueue.toggleLoop();
    }
  }

  window.addEventListener('keydown', handleKeyDown);

  window.XMShortcuts = {
    openHelp: openHelpModal,
    seekRelative,
    adjustVolume,
    cyclePlaybackMode
  };
})(window);