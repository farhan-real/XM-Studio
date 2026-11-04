/**
 * js/data/scroller.js - Android-optimized custom scrollbar and rAF windowing coordinator.
 */
(function(window) {
  function createScroller(options) {
    const viewport = options.viewport;
    const track = options.track;
    const thumb = options.thumb;
    const itemHeight = options.itemHeight || 54;
    const buffer = options.buffer || 6;
    const onRender = options.onRender;

    let totalItems = 0;
    let scrollTop = 0;
    let maxScroll = 0;
    let thumbHeight = 28;
    let maxTravel = 0;
    let cachedVh = 430;
    let cachedTh = 430;
    let isDragging = false;
    let dragStartPointerY = 0;
    let dragStartScrollTop = 0;

    let isTouching = false;
    let isTouchDragging = false;
    let suppressNextClick = false;
    let touchStartY = 0;
    let touchLastY = 0;
    let touchLastTime = 0;
    let touchVelocity = 0;
    let touchAnimId = null;

    let rafPending = false;
    let pendingRebuild = false;

    function measureDimensions() {
      const vh = viewport.clientHeight;
      const th = track.clientHeight;
      if (vh > 0) cachedVh = vh;
      if (th > 0) cachedTh = th;
      else if (vh > 0) cachedTh = vh;
    }

    function updateMetrics() {
      measureDimensions();
      const totalH = totalItems * itemHeight;
      maxScroll = Math.max(0, totalH - cachedVh);

      if (maxScroll <= 0 || totalItems === 0) {
        track.classList.add('hide');
        thumbHeight = 0;
        maxTravel = 0;
        scrollTop = 0;
      } else {
        track.classList.remove('hide');
        measureDimensions();
        const viewRatio = cachedVh / totalH;
        thumbHeight = Math.max(28, Math.min(cachedTh, Math.round(cachedTh * viewRatio)));
        maxTravel = Math.max(1, cachedTh - thumbHeight);
        thumb.style.height = `${thumbHeight}px`;
      }
    }

    function syncThumb() {
      if (maxTravel <= 0 || maxScroll <= 0) return;
      const fraction = Math.max(0, Math.min(1, scrollTop / maxScroll));
      thumb.style.transform = `translate3d(0,${Math.round(fraction * maxTravel)}px,0)`;
    }

    function emitRender(forceRebuild) {
      if (totalItems === 0) {
        if (onRender) onRender(0, 0, 0, true);
        return;
      }
      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
      const end = Math.min(totalItems, Math.ceil((scrollTop + cachedVh) / itemHeight) + buffer);
      if (onRender) onRender(start, end, scrollTop, Boolean(forceRebuild));
    }

    function scheduleSync(forceRebuild) {
      if (forceRebuild) pendingRebuild = true;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const force = pendingRebuild;
        pendingRebuild = false;
        syncThumb();
        emitRender(force);
      });
    }

    function setScroll(targetTop, forceRebuild) {
      const clamped = Math.max(0, Math.min(maxScroll, targetTop));
      if (clamped === scrollTop && !forceRebuild) return;
      scrollTop = clamped;
      scheduleSync(forceRebuild);
    }

    function setTotal(count, forceReset = false) {
      totalItems = count;
      if (forceReset) scrollTop = 0;
      updateMetrics();
      if (scrollTop > maxScroll) scrollTop = maxScroll;
      scheduleSync(true);
    }

    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      dragStartPointerY = e.clientY;
      dragStartScrollTop = scrollTop;
      thumb.classList.add('dragging');
      thumb.setPointerCapture(e.pointerId);
      if (window.XMVisualizer) window.XMVisualizer.setThrottled(true);
    });

    thumb.addEventListener('pointermove', (e) => {
      if (!isDragging || maxTravel <= 0) return;
      const deltaY = e.clientY - dragStartPointerY;
      const scrollDelta = (deltaY / maxTravel) * maxScroll;
      setScroll(dragStartScrollTop + scrollDelta, false);
    });

    function endThumbDrag(e) {
      if (!isDragging) return;
      isDragging = false;
      thumb.classList.remove('dragging');
      try { thumb.releasePointerCapture(e.pointerId); } catch (err) {}
      if (window.XMVisualizer) window.XMVisualizer.setThrottled(false);
    }
    thumb.addEventListener('pointerup', endThumbDrag);
    thumb.addEventListener('pointercancel', endThumbDrag);

    track.addEventListener('pointerdown', (e) => {
      if (e.target === thumb) return;
      e.preventDefault();
      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const targetTravelPos = clickY - thumbHeight / 2;
      const fraction = Math.max(0, Math.min(1, targetTravelPos / maxTravel));
      setScroll(fraction * maxScroll, false);
    });

    viewport.addEventListener('wheel', (e) => {
      if (maxScroll <= 0) return;
      e.preventDefault();
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 40;
      else if (e.deltaMode === 2) delta *= cachedVh;
      setScroll(scrollTop + delta, false);
    }, { passive: false });

    viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      if (touchAnimId) { cancelAnimationFrame(touchAnimId); touchAnimId = null; }
      if (maxScroll <= 0) updateMetrics();
      isTouching = true;
      isTouchDragging = false;
      touchStartY = e.touches[0].clientY;
      touchLastY = touchStartY;
      touchLastTime = performance.now();
      touchVelocity = 0;
      if (window.XMVisualizer) window.XMVisualizer.setThrottled(true);
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
      if (!isTouching || e.touches.length !== 1 || maxScroll <= 0) return;
      const currentY = e.touches[0].clientY;
      if (!isTouchDragging) {
        if (Math.abs(currentY - touchStartY) < 6) return;
        isTouchDragging = true;
        touchLastY = currentY;
        touchLastTime = performance.now();
      }
      if (e.cancelable) e.preventDefault();
      const deltaY = touchLastY - currentY;
      const now = performance.now();
      const dt = Math.max(1, now - touchLastTime);
      touchVelocity = 0.65 * (deltaY / dt) + 0.35 * touchVelocity;
      touchLastY = currentY;
      touchLastTime = now;
      setScroll(scrollTop + deltaY, false);
    }, { passive: false });

    function onTouchEnd() {
      if (!isTouching) return;
      isTouching = false;
      if (window.XMVisualizer) window.XMVisualizer.setThrottled(false);
      if (!isTouchDragging) return;
      isTouchDragging = false;
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 100);

      if (maxScroll <= 0 || Math.abs(touchVelocity) < 0.08) return;
      let v = touchVelocity * 16;
      function momentum() {
        if (Math.abs(v) < 0.35 || document.hidden) { touchAnimId = null; return; }
        setScroll(scrollTop + v, false);
        v *= 0.94;
        touchAnimId = requestAnimationFrame(momentum);
      }
      touchAnimId = requestAnimationFrame(momentum);
    }

    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', () => {
      isTouching = false;
      isTouchDragging = false;
      if (window.XMVisualizer) window.XMVisualizer.setThrottled(false);
    }, { passive: true });

    viewport.addEventListener('click', (e) => {
      if (suppressNextClick) {
        e.stopPropagation();
        e.preventDefault();
        suppressNextClick = false;
      }
    }, true);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && touchAnimId) {
        cancelAnimationFrame(touchAnimId);
        touchAnimId = null;
      }
    });

    return {
      setTotal,
      setScroll,
      scrollToIndex: (idx) => { setScroll(idx * itemHeight - (cachedVh - itemHeight) / 2, false); },
      refresh: () => { updateMetrics(); scheduleSync(true); },
      getScrollTop: () => scrollTop
    };
  }

  window.XMScroller = { create: createScroller };
})(window);