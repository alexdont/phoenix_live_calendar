/**
 * PhoenixLiveCalendar JS Hooks
 *
 * Optional JavaScript hooks for enhanced interactions.
 * The calendar works without these — they add drag-to-select,
 * drag-to-move, drag-to-resize, and responsive container detection.
 *
 * Usage in your app.js:
 *
 *   import "../../deps/phoenix_live_calendar/priv/static/assets/phoenix_live_calendar.js"
 *
 *   let liveSocket = new LiveSocket("/live", Socket, {
 *     hooks: { ...window.PhoenixLiveCalendarHooks, ...myHooks }
 *   })
 */

(function () {
  "use strict";

  window.PhoenixLiveCalendarHooks = window.PhoenixLiveCalendarHooks || {};

  // ============================================================
  // TimeRangeSelect — drag to select a time range on a time grid
  // ============================================================
  window.PhoenixLiveCalendarHooks.TimeRangeSelect = {
    mounted() {
      this.selecting = false;
      this.startSlot = null;
      this.endSlot = null;

      this._onPointerDown = (e) => {
        const slot = e.target.closest("[data-slot]");
        if (!slot) return;

        e.preventDefault();
        this.selecting = true;
        this.startSlot = slot.dataset.slot;
        this.endSlot = slot.dataset.slot;
        this.startDate = slot.closest("[data-date]")?.dataset.date;

        // Capture pointer for tracking outside element
        this.el.setPointerCapture(e.pointerId);
        this._highlightRange();
      };

      this._onPointerMove = (e) => {
        if (!this.selecting) return;

        const el = document.elementFromPoint(e.clientX, e.clientY);
        const slot = el?.closest("[data-slot]");
        if (slot && slot.dataset.slot !== this.endSlot) {
          this.endSlot = slot.dataset.slot;
          this._highlightRange();
        }
      };

      this._onPointerUp = (e) => {
        if (!this.selecting) return;
        this.selecting = false;

        // Clear visual highlight
        this._clearHighlight();

        // Determine the ordered range
        const start = this.startSlot < this.endSlot ? this.startSlot : this.endSlot;
        const end = this.startSlot < this.endSlot ? this.endSlot : this.startSlot;

        // Push final selection to server
        this.pushEventTo(this.el, "lc_range_select", {
          date: this.startDate,
          start_time: start,
          end_time: end,
        });
      };

      this._onKeyDown = (e) => {
        if (e.key === "Escape" && this.selecting) {
          this.selecting = false;
          this._clearHighlight();
        }
      };

      this.el.addEventListener("pointerdown", this._onPointerDown);
      this.el.addEventListener("pointermove", this._onPointerMove);
      this.el.addEventListener("pointerup", this._onPointerUp);
      document.addEventListener("keydown", this._onKeyDown);

      // Prevent scroll on touch during selection
      this.el.style.touchAction = "none";
    },

    _highlightRange() {
      const slots = this.el.querySelectorAll("[data-slot]");
      const start = this.startSlot < this.endSlot ? this.startSlot : this.endSlot;
      const end = this.startSlot < this.endSlot ? this.endSlot : this.startSlot;

      slots.forEach((slot) => {
        const t = slot.dataset.slot;
        if (t >= start && t <= end) {
          slot.classList.add("cal-selecting");
        } else {
          slot.classList.remove("cal-selecting");
        }
      });
    },

    _clearHighlight() {
      this.el.querySelectorAll(".cal-selecting").forEach((el) => {
        el.classList.remove("cal-selecting");
      });
    },

    destroyed() {
      this.el.removeEventListener("pointerdown", this._onPointerDown);
      this.el.removeEventListener("pointermove", this._onPointerMove);
      this.el.removeEventListener("pointerup", this._onPointerUp);
      document.removeEventListener("keydown", this._onKeyDown);
    },
  };

  // ============================================================
  // EventDrag — drag to move an event to a new time/date
  // ============================================================
  window.PhoenixLiveCalendarHooks.EventDrag = {
    mounted() {
      this._dragging = null;
      this._ghost = null;
      this._startX = 0;
      this._startY = 0;

      this._onPointerDown = (e) => {
        const eventEl = e.target.closest("[data-event-id]");
        if (!eventEl || eventEl.dataset.editable === "false") return;

        // Require minimum movement before starting drag
        this._startX = e.clientX;
        this._startY = e.clientY;
        this._pendingDrag = eventEl;
        this._pointerId = e.pointerId;
      };

      this._onPointerMove = (e) => {
        if (this._pendingDrag && !this._dragging) {
          const dx = Math.abs(e.clientX - this._startX);
          const dy = Math.abs(e.clientY - this._startY);

          // Min 5px movement to start drag
          if (dx + dy > 5) {
            this._startDrag(this._pendingDrag, e);
            this._pendingDrag = null;
          }
          return;
        }

        if (!this._dragging) return;

        // Move ghost element
        if (this._ghost) {
          this._ghost.style.left = e.clientX - this._offsetX + "px";
          this._ghost.style.top = e.clientY - this._offsetY + "px";
        }

        // Highlight drop target
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const slot = target?.closest("[data-slot]");
        const dateCol = target?.closest("[data-date]");

        this.el.querySelectorAll(".cal-drop-target").forEach((el) =>
          el.classList.remove("cal-drop-target")
        );

        if (slot) slot.classList.add("cal-drop-target");
        else if (dateCol) dateCol.classList.add("cal-drop-target");
      };

      this._onPointerUp = (e) => {
        this._pendingDrag = null;

        if (!this._dragging) return;

        // Find drop target
        if (this._ghost) {
          this._ghost.style.display = "none";
        }
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (this._ghost) {
          this._ghost.style.display = "";
        }

        const slot = target?.closest("[data-slot]");
        const dateCol = target?.closest("[data-date]");

        // Clean up
        this._cleanupDrag();

        // Push event to server
        if (slot || dateCol) {
          this.pushEventTo(this.el, "lc_event_drop", {
            event_id: this._dragging,
            new_date: dateCol?.dataset.date,
            new_time: slot?.dataset.slot,
            resource_id:
              dateCol?.dataset.resourceId || slot?.closest("[data-resource-id]")?.dataset.resourceId,
          });
        }

        this._dragging = null;
      };

      this.el.addEventListener("pointerdown", this._onPointerDown);
      document.addEventListener("pointermove", this._onPointerMove);
      document.addEventListener("pointerup", this._onPointerUp);
    },

    _startDrag(eventEl, e) {
      this._dragging = eventEl.dataset.eventId;

      // Create ghost
      this._ghost = eventEl.cloneNode(true);
      this._ghost.classList.add("cal-ghost");
      this._ghost.style.position = "fixed";
      this._ghost.style.zIndex = "9999";
      this._ghost.style.opacity = "0.7";
      this._ghost.style.pointerEvents = "none";
      this._ghost.style.width = eventEl.offsetWidth + "px";

      const rect = eventEl.getBoundingClientRect();
      this._offsetX = e.clientX - rect.left;
      this._offsetY = e.clientY - rect.top;
      this._ghost.style.left = rect.left + "px";
      this._ghost.style.top = rect.top + "px";

      document.body.appendChild(this._ghost);

      // Dim original
      eventEl.classList.add("cal-dragging");

      // Capture pointer
      this.el.setPointerCapture(this._pointerId);
    },

    _cleanupDrag() {
      if (this._ghost) {
        this._ghost.remove();
        this._ghost = null;
      }

      this.el.querySelectorAll(".cal-dragging").forEach((el) =>
        el.classList.remove("cal-dragging")
      );
      this.el.querySelectorAll(".cal-drop-target").forEach((el) =>
        el.classList.remove("cal-drop-target")
      );
    },

    destroyed() {
      this._cleanupDrag();
      this.el.removeEventListener("pointerdown", this._onPointerDown);
      document.removeEventListener("pointermove", this._onPointerMove);
      document.removeEventListener("pointerup", this._onPointerUp);
    },
  };

  // ============================================================
  // EventResize — drag event edge to resize duration
  // ============================================================
  window.PhoenixLiveCalendarHooks.EventResize = {
    mounted() {
      this._resizing = null;

      this._onPointerDown = (e) => {
        const handle = e.target.closest("[data-resize-handle]");
        if (!handle) return;

        e.preventDefault();
        e.stopPropagation();

        const eventEl = handle.closest("[data-event-id]");
        if (!eventEl || eventEl.dataset.editable === "false") return;

        this._resizing = {
          eventId: eventEl.dataset.eventId,
          edge: handle.dataset.resizeHandle, // "top" or "bottom"
          startY: e.clientY,
          originalHeight: eventEl.offsetHeight,
          originalTop: eventEl.offsetTop,
          element: eventEl,
        };

        this.el.setPointerCapture(e.pointerId);
        eventEl.classList.add("cal-resizing");
      };

      this._onPointerMove = (e) => {
        if (!this._resizing) return;

        const dy = e.clientY - this._resizing.startY;

        if (this._resizing.edge === "bottom") {
          const newHeight = Math.max(20, this._resizing.originalHeight + dy);
          this._resizing.element.style.height = newHeight + "px";
        } else if (this._resizing.edge === "top") {
          const newHeight = Math.max(20, this._resizing.originalHeight - dy);
          const newTop = this._resizing.originalTop + dy;
          this._resizing.element.style.height = newHeight + "px";
          this._resizing.element.style.top = newTop + "px";
        }
      };

      this._onPointerUp = (e) => {
        if (!this._resizing) return;

        // Find the nearest slot to the new edge position
        const rect = this._resizing.element.getBoundingClientRect();
        const targetY =
          this._resizing.edge === "bottom" ? rect.bottom : rect.top;

        const allSlots = this.el.querySelectorAll("[data-slot]");
        let nearestSlot = null;
        let nearestDist = Infinity;

        allSlots.forEach((slot) => {
          const slotRect = slot.getBoundingClientRect();
          const dist = Math.abs(slotRect.top - targetY);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestSlot = slot;
          }
        });

        this._resizing.element.classList.remove("cal-resizing");
        // Reset inline styles — server will re-render
        this._resizing.element.style.height = "";
        this._resizing.element.style.top = "";

        if (nearestSlot) {
          this.pushEventTo(this.el, "lc_event_resize", {
            event_id: this._resizing.eventId,
            edge: this._resizing.edge,
            new_time: nearestSlot.dataset.slot,
          });
        }

        this._resizing = null;
      };

      this.el.addEventListener("pointerdown", this._onPointerDown);
      this.el.addEventListener("pointermove", this._onPointerMove);
      this.el.addEventListener("pointerup", this._onPointerUp);
    },

    destroyed() {
      this.el.removeEventListener("pointerdown", this._onPointerDown);
      this.el.removeEventListener("pointermove", this._onPointerMove);
      this.el.removeEventListener("pointerup", this._onPointerUp);
    },
  };

  // ============================================================
  // ResponsiveContainer — reports container width for adaptive views
  // ============================================================
  window.PhoenixLiveCalendarHooks.ResponsiveContainer = {
    mounted() {
      this._lastWidth = null;

      this._observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = Math.round(entry.contentRect.width);

          // Only push if width changed meaningfully (>10px)
          if (
            this._lastWidth === null ||
            Math.abs(width - this._lastWidth) > 10
          ) {
            this._lastWidth = width;
            this._debouncedPush(width);
          }
        }
      });

      this._observer.observe(this.el);

      // Debounce helper
      this._timer = null;
      this._debouncedPush = (width) => {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => {
          this.pushEventTo(this.el, "lc_container_resized", { width: width });
        }, 150);
      };
    },

    destroyed() {
      if (this._observer) {
        this._observer.disconnect();
      }
      clearTimeout(this._timer);
    },
  };

  // ============================================================
  // TouchHandler — long-press detection for mobile drag
  // ============================================================
  window.PhoenixLiveCalendarHooks.TouchHandler = {
    mounted() {
      this._longPressDelay = parseInt(this.el.dataset.longPressDelay || "500");
      this._timer = null;

      this._onTouchStart = (e) => {
        const target = e.target.closest("[data-event-id]");
        if (!target) return;

        this._timer = setTimeout(() => {
          target.classList.add("cal-long-press");
          // Trigger a custom event that EventDrag can pick up
          target.dispatchEvent(
            new PointerEvent("pointerdown", {
              clientX: e.touches[0].clientX,
              clientY: e.touches[0].clientY,
              pointerId: 0,
              bubbles: true,
            })
          );
        }, this._longPressDelay);
      };

      this._onTouchMove = () => {
        clearTimeout(this._timer);
      };

      this._onTouchEnd = () => {
        clearTimeout(this._timer);
        this.el.querySelectorAll(".cal-long-press").forEach((el) =>
          el.classList.remove("cal-long-press")
        );
      };

      this.el.addEventListener("touchstart", this._onTouchStart, {
        passive: true,
      });
      this.el.addEventListener("touchmove", this._onTouchMove, {
        passive: true,
      });
      this.el.addEventListener("touchend", this._onTouchEnd);
    },

    destroyed() {
      clearTimeout(this._timer);
      this.el.removeEventListener("touchstart", this._onTouchStart);
      this.el.removeEventListener("touchmove", this._onTouchMove);
      this.el.removeEventListener("touchend", this._onTouchEnd);
    },
  };

  // ============================================================
  // PopoverPause — pauses tickers while a popover/modal is open
  // ============================================================
  window.PhoenixLiveCalendarHooks.PopoverPause = {
    mounted() {
      window.dispatchEvent(
        new CustomEvent("lc:ticker-pause", { detail: { paused: true } })
      );
    },
    destroyed() {
      window.dispatchEvent(
        new CustomEvent("lc:ticker-pause", { detail: { paused: false } })
      );
    },
  };

  // ============================================================
  // MarkerTicker — cycles through day marker labels one at a time
  // ============================================================
  window.PhoenixLiveCalendarHooks.MarkerTicker = {
    mounted() {
      this._paused = false;
      this._interval = parseInt(this.el.dataset.interval || "3000");
      this._refresh();

      // Always run the timer and guard inside it: a LiveView patch can change
      // the item count either way, and _refresh() alone can't start a timer
      // that mounted() skipped.
      this._timer = setInterval(() => {
        if (this._paused || this._count <= 1) return;
        this._advance();
      }, this._interval);

      // Pause on hover so user can read
      this.el.addEventListener("mouseenter", () => {
        this._paused = true;
        clearTimeout(this._resumeTimer);
      });
      this.el.addEventListener("mouseleave", () => {
        this._paused = true;
        // Resume after a short delay to avoid jarring immediate switch.
        // Track the timer: a quick leave→re-enter must cancel the pending
        // resume, or the ticker advances while hovered.
        clearTimeout(this._resumeTimer);
        this._resumeTimer = setTimeout(() => { this._paused = false; }, 500);
      });

      // Listen for external pause (e.g., popover open). Pausing must also
      // cancel a pending hover-resume, or a mouseleave shortly before the
      // event un-pauses the ticker 500ms into the popover.
      this._onPause = (e) => {
        if (e.detail && e.detail.paused !== undefined) {
          this._paused = e.detail.paused;
          if (this._paused) clearTimeout(this._resumeTimer);
        }
      };
      window.addEventListener("lc:ticker-pause", this._onPause);
    },

    updated() {
      // A LiveView patch re-rendered the ticker: the server put item 0 back
      // in the visible state and the cached NodeList points at stale nodes —
      // re-query and restart the cycle from 0. A patched data-interval also
      // re-arms the timer.
      this._refresh();
      const interval = parseInt(this.el.dataset.interval || "3000");
      if (interval !== this._interval) {
        this._interval = interval;
        clearInterval(this._timer);
        this._timer = setInterval(() => {
          if (this._paused || this._count <= 1) return;
          this._advance();
        }, this._interval);
      }
    },

    _refresh() {
      this._items = this.el.querySelectorAll("[data-ticker-index]");
      this._count = this._items.length;
      this._current = 0;
    },

    _advance() {
      this._items[this._current].classList.remove("opacity-100");
      this._items[this._current].classList.add("opacity-0", "pointer-events-none");
      this._current = (this._current + 1) % this._count;
      this._items[this._current].classList.remove("opacity-0", "pointer-events-none");
      this._items[this._current].classList.add("opacity-100");
    },

    destroyed() {
      clearInterval(this._timer);
      clearTimeout(this._resumeTimer);
      window.removeEventListener("lc:ticker-pause", this._onPause);
    },
  };

  // ============================================================
  // SyncAnimations — keep the overdue overlay consistent across cells
  // ============================================================
  // Two jobs, both so a striped/animated overlay reads as one continuous thing
  // across separately-rendered day-cells:
  //
  //  1. Phase: CSS animations begin when their element is first rendered, so
  //     cells patched in at different times (e.g. paging a calendar) drift out
  //     of phase. We re-anchor every animation in the subtree to the same start
  //     time (0 = the document timeline origin); per-element `animation-delay` is
  //     preserved, so a staggered wave stays staggered AND synced.
  //
  //  2. Alignment: a per-cell background gradient normally restarts at each
  //     cell's own box, so diagonal stripes don't line up cell-to-cell. We set
  //     `--pk-bg-x/y` on each `.pk-overdue` to its offset from this container's
  //     origin, so every cell shows its slice of ONE shared pattern. The offset
  //     is relative (not viewport-fixed), so it stays correct on scroll.
  //
  // Recomputed on mount, on subtree changes (MutationObserver — paging) and on
  // size changes (ResizeObserver — window resize + becoming visible after a tab
  // switch). Progressive enhancement: without it the CSS still renders, the
  // stripes just don't line up / animations can drift after a re-render.
  window.PhoenixLiveCalendarHooks.SyncAnimations = {
    mounted() {
      this._apply();

      if (typeof MutationObserver !== "undefined") {
        this._observer = new MutationObserver(() => this._apply());
        this._observer.observe(this.el, { childList: true, subtree: true });
      }

      if (typeof ResizeObserver !== "undefined") {
        this._resize = new ResizeObserver(() => this._apply());
        this._resize.observe(this.el);
      }
    },

    _apply() {
      if (this._scheduled) return;
      this._scheduled = true;
      requestAnimationFrame(() => {
        this._scheduled = false;
        this._alignStripes();
        this._syncAnimations();
      });
    },

    // Anchor each overdue cell's gradient to this container's origin so the
    // diagonals line up across cells/rows.
    _alignStripes() {
      const root = this.el.getBoundingClientRect();
      this.el.querySelectorAll(".pk-overdue").forEach((el) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--pk-bg-x", Math.round(root.left - r.left) + "px");
        el.style.setProperty("--pk-bg-y", Math.round(root.top - r.top) + "px");
      });
    },

    _syncAnimations() {
      if (!this.el.getAnimations) return;
      this.el.getAnimations({ subtree: true }).forEach((a) => {
        try {
          a.startTime = 0;
        } catch (e) {
          /* animation not yet ready / no settable startTime — ignore */
        }
      });
    },

    destroyed() {
      if (this._observer) this._observer.disconnect();
      if (this._resize) this._resize.disconnect();
    },
  };

  // ============================================================
  // TimeGridEdit — move and resize timed events in place (editable_events)
  // ============================================================
  // On the week/day/N-day grid root when `editable_events` is set. Works on
  // the server-rendered DOM only: an editable block's positioned wrapper is
  // `[data-event-wrapper]`, its edges are `[data-resize-handle]`, and every
  // slot carries `data-slot` / `data-slot-end` in its day column
  // (`[data-date]`). It snaps to those slots, so the times it reports are
  // always the server's own slot boundaries — it does no time arithmetic.
  //
  //   * drag a block (5px dead zone) → `lc_event_drop {event_id, new_date,
  //     new_time}`: the slot under the block's TOP edge, in the column under
  //     the pointer (looking through other blocks);
  //   * pull an edge → `lc_event_resize {event_id, edge, new_time}`: the top
  //     edge snaps to a slot start, the bottom to a slot end; never past the
  //     other edge (at least one slot).
  //
  // The block itself follows the pointer as a preview; the server's
  // re-render puts it where it really is. A drag swallows the click that
  // follows it, Escape cancels, and the blocks are `touch-action: none` so a
  // finger drags them while the rest of the grid still scrolls.
  window.PhoenixLiveCalendarHooks.TimeGridEdit = {
    mounted() {
      this._op = null;

      this._onDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        var wrapper = e.target.closest && e.target.closest("[data-event-wrapper]");
        if (!wrapper || !this.el.contains(wrapper)) return;
        var column = wrapper.closest("[data-date]");
        if (!column) return;

        var handle = e.target.closest("[data-resize-handle]");
        var rect = wrapper.getBoundingClientRect();
        this._op = {
          kind: handle ? "resize" : "pending",
          edge: handle ? handle.getAttribute("data-resize-handle") : null,
          id: wrapper.getAttribute("data-event-wrapper"),
          wrapper: wrapper,
          home: wrapper.parentElement,
          column: column,
          startX: e.clientX,
          startY: e.clientY,
          grabOffset: e.clientY - rect.top,
          original: { top: wrapper.style.top, height: wrapper.style.height, left: wrapper.style.insetInlineStart, width: wrapper.style.width },
          target: null,
        };
        if (handle) {
          e.preventDefault();
          e.stopPropagation();
          wrapper.classList.add("cal-resizing");
        }
      };

      this._onMove = (e) => {
        var op = this._op;
        if (!op) return;
        if (op.kind === "pending") {
          if (Math.abs(e.clientX - op.startX) + Math.abs(e.clientY - op.startY) <= 5) return;
          op.kind = "move";
          op.wrapper.classList.add("cal-dragging");
        }
        e.preventDefault();
        if (op.kind === "move") this._previewMove(e);
        else this._previewResize(e);
      };

      this._onUp = (e) => {
        var op = this._op;
        if (!op) return;
        this._op = null;
        if (op.kind === "pending") return; // a click: let it through

        // The click that follows a drag must not open the event.
        var swallow = function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        };
        this.el.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => this.el.removeEventListener("click", swallow, { capture: true }), 0);

        this._reset(op);
        if (!op.target) return;

        if (op.kind === "move") {
          this.pushEventTo(this.el, "lc_event_drop", {
            event_id: op.id,
            new_date: op.target.date,
            new_time: op.target.time,
            resource_id: null,
          });
        } else {
          this.pushEventTo(this.el, "lc_event_resize", {
            event_id: op.id,
            edge: op.edge,
            new_time: op.target.time,
          });
        }
      };

      this._onCancel = () => {
        if (!this._op) return;
        this._reset(this._op);
        this._op = null;
      };

      this._onKey = (e) => {
        if (e.key === "Escape") this._onCancel();
      };

      this.el.addEventListener("pointerdown", this._onDown);
      document.addEventListener("pointermove", this._onMove);
      document.addEventListener("pointerup", this._onUp);
      document.addEventListener("pointercancel", this._onCancel);
      document.addEventListener("keydown", this._onKey);
    },

    destroyed() {
      this.el.removeEventListener("pointerdown", this._onDown);
      document.removeEventListener("pointermove", this._onMove);
      document.removeEventListener("pointerup", this._onUp);
      document.removeEventListener("pointercancel", this._onCancel);
      document.removeEventListener("keydown", this._onKey);
    },

    // The slot of `column` at viewport height `y` (clamped to the column).
    _slotAt(column, y) {
      var slots = column.querySelectorAll("[data-slot]");
      if (!slots.length) return null;
      for (var i = 0; i < slots.length; i++) {
        var r = slots[i].getBoundingClientRect();
        if (y < r.bottom) return slots[i];
      }
      return slots[slots.length - 1];
    },

    _columnAt(x, y) {
      var stack = document.elementsFromPoint(x, y);
      for (var i = 0; i < stack.length; i++) {
        var col = stack[i].closest && stack[i].closest("[data-date]");
        if (col && this.el.contains(col) && col.querySelector("[data-slot]")) return col;
      }
      return null;
    },

    _previewMove(e) {
      var op = this._op;
      var column = this._columnAt(e.clientX, e.clientY) || op.column;
      var slot = this._slotAt(column, e.clientY - op.grabOffset);
      if (!slot) return;

      // Show the block where it would land: in the target column, at the slot.
      if (column !== op.wrapper.parentElement.closest("[data-date]")) {
        var layer = column.querySelector(".cal-event-layer");
        if (layer) layer.appendChild(op.wrapper);
      }
      var colTop = column.getBoundingClientRect().top;
      op.wrapper.style.top = slot.getBoundingClientRect().top - colTop + "px";
      op.wrapper.style.insetInlineStart = "0%";
      op.wrapper.style.width = "100%";
      op.target = { date: column.getAttribute("data-date"), time: slot.getAttribute("data-slot") };
    },

    _previewResize(e) {
      var op = this._op;
      var column = op.column;
      var colTop = column.getBoundingClientRect().top;
      var rect = op.wrapper.getBoundingClientRect();
      var slot = this._slotAt(column, e.clientY);
      if (!slot) return;
      var r = slot.getBoundingClientRect();

      if (op.edge === "bottom") {
        // Never above the block's first slot: at least one slot long.
        var first = this._slotAt(column, rect.top + 1);
        if (first && r.top < first.getBoundingClientRect().top) {
          slot = first;
          r = slot.getBoundingClientRect();
        }
        var bottom = r.bottom;
        var endTime = slot.getAttribute("data-slot-end");

        // edit_magnet: stop at the next block's top, and snap to it nearby.
        var next = this._magnet(op, "below");
        if (next) {
          var limit = next.getBoundingClientRect().top;
          if (bottom > limit || Math.abs(bottom - limit) < this.SNAP_PX) {
            bottom = limit;
            endTime = next.getAttribute("data-window-start");
          }
        }
        op.wrapper.style.height = Math.max(bottom - rect.top, 4) + "px";
        op.target = { time: endTime };
      } else {
        var last = this._slotAt(column, rect.bottom - 1);
        if (last && r.top > last.getBoundingClientRect().top) {
          slot = last;
          r = slot.getBoundingClientRect();
        }
        var top = r.top;
        var startTime = slot.getAttribute("data-slot");

        // edit_magnet: stop at the previous block's bottom, snap to it nearby.
        var prev = this._magnet(op, "above");
        if (prev) {
          var floor = prev.getBoundingClientRect().bottom;
          if (top < floor || Math.abs(top - floor) < this.SNAP_PX) {
            top = floor;
            startTime = prev.getAttribute("data-window-end");
          }
        }
        op.wrapper.style.top = top - colTop + "px";
        op.wrapper.style.height = Math.max(rect.bottom - top, 4) + "px";
        op.target = { time: startTime };
      }
    },

    SNAP_PX: 12,

    // With edit_magnet, the nearest OTHER editable block in the column that
    // a pulled edge must not cross: "below" → the first one starting at or
    // after this block's start; "above" → the last one ending at or before
    // this block's end and starting before it. Times compare as
    // "HH:MM:SS" strings (the server's own window times), so no clock maths.
    _magnet(op, direction) {
      if (this.el.getAttribute("data-edit-magnet") !== "true") return null;
      var ownStart = op.wrapper.getAttribute("data-window-start");
      var ownEnd = op.wrapper.getAttribute("data-window-end");
      var best = null;
      op.column.querySelectorAll("[data-event-wrapper]").forEach(function (w) {
        if (w === op.wrapper) return;
        var s = w.getAttribute("data-window-start");
        var e = w.getAttribute("data-window-end");
        if (!s || !e) return;
        if (direction === "below") {
          if (s >= ownStart && (!best || s < best.getAttribute("data-window-start"))) best = w;
        } else if (s < ownStart && e <= ownEnd && (!best || e > best.getAttribute("data-window-end"))) {
          best = w;
        }
      });
      return best;
    },

    // Put the block back as the server drew it; its re-render (after the
    // push) moves it for real, or leaves it if the host refused.
    _reset(op) {
      op.wrapper.classList.remove("cal-dragging", "cal-resizing");
      if (op.home && op.wrapper.parentElement !== op.home) op.home.appendChild(op.wrapper);
      op.wrapper.style.top = op.original.top;
      op.wrapper.style.height = op.original.height;
      op.wrapper.style.insetInlineStart = op.original.left;
      op.wrapper.style.width = op.original.width;
    },
  };

  // ============================================================
  // ExternalDrop — accept items dragged in from OUTSIDE the calendar
  // ============================================================
  // Native HTML drag and drop. A host marks any element outside the calendar
  // with `data-lc-external-id="<its id>"` (and `draggable="true"`); this hook,
  // on the view container when `on_external_drop` is set, accepts it on:
  //
  //   * a time slot — any element carrying `phx-value-date` + `phx-value-time`
  //     (week/day/N-day/resource), found UNDER the pointer even when an event
  //     block is on top of it → `%{external_id, date, time, resource_id}`;
  //   * a day without slots (a month cell, `data-date`) → `time: null`.
  //
  // Only drags that started on a `data-lc-external-id` element are accepted
  // (its id travels as the `application/x-lc-external-id` type), so dropping
  // a file or a link does nothing. Without JS there is nothing to drag, and
  // the host's own form sets the time: the no-JS render is unchanged.
  var EXTERNAL_TYPE = "application/x-lc-external-id";

  // One document-level listener tags every drag that starts on a marked
  // element, whichever calendar it ends up over.
  if (!window.__lcExternalDragTagging) {
    window.__lcExternalDragTagging = true;
    document.addEventListener("dragstart", function (e) {
      var source = e.target && e.target.closest && e.target.closest("[data-lc-external-id]");
      if (!source || !e.dataTransfer) return;
      e.dataTransfer.setData(EXTERNAL_TYPE, source.getAttribute("data-lc-external-id"));
      e.dataTransfer.effectAllowed = "copyMove";
    });
  }

  window.PhoenixLiveCalendarHooks.ExternalDrop = {
    mounted() {
      this._target = null;

      this._onDragOver = (e) => {
        if (!this._accepts(e)) return;
        var target = this._dropTarget(e);
        if (!target) return this._mark(null);
        e.preventDefault(); // allow the drop
        e.dataTransfer.dropEffect = "move";
        this._mark(target.el);
      };

      this._onDragLeave = (e) => {
        if (!this.el.contains(e.relatedTarget)) this._mark(null);
      };

      this._onDrop = (e) => {
        if (!this._accepts(e)) return;
        var target = this._dropTarget(e);
        this._mark(null);
        if (!target) return;
        e.preventDefault();
        var id = e.dataTransfer.getData(EXTERNAL_TYPE);
        if (!id) return;
        this.pushEventTo(this.el, "lc_external_drop", {
          external_id: id,
          date: target.date,
          time: target.time,
          resource_id: target.resourceId,
        });
      };

      this.el.addEventListener("dragover", this._onDragOver);
      this.el.addEventListener("dragleave", this._onDragLeave);
      this.el.addEventListener("drop", this._onDrop);
    },

    destroyed() {
      this.el.removeEventListener("dragover", this._onDragOver);
      this.el.removeEventListener("dragleave", this._onDragLeave);
      this.el.removeEventListener("drop", this._onDrop);
    },

    _accepts(e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      return !!types && Array.prototype.indexOf.call(types, EXTERNAL_TYPE) !== -1;
    },

    // The slot under the pointer (looking through event blocks), else a
    // slot-less day cell; null over anything else (headers, the gutter).
    _dropTarget(e) {
      var stack = document.elementsFromPoint(e.clientX, e.clientY);
      for (var i = 0; i < stack.length; i++) {
        var node = stack[i];
        if (!this.el.contains(node)) continue;
        if (node.hasAttribute("phx-value-time") && node.hasAttribute("phx-value-date")) {
          return {
            el: node,
            date: node.getAttribute("phx-value-date"),
            time: node.getAttribute("phx-value-time"),
            resourceId: node.getAttribute("phx-value-resource-id"),
          };
        }
      }
      var day = e.target.closest && e.target.closest("[data-date]");
      if (day && this.el.contains(day) && !day.querySelector("[phx-value-time]")) {
        return { el: day, date: day.getAttribute("data-date"), time: null, resourceId: null };
      }
      return null;
    },

    _mark(el) {
      if (this._target === el) return;
      if (this._target) this._target.classList.remove("cal-drop-target");
      this._target = el;
      if (el) el.classList.add("cal-drop-target");
    },
  };

  // ============================================================
  // ScrollToTime — open a time grid scrolled to a time (scroll_to)
  // ============================================================
  // Sits on the server-rendered `.cal-scroll-anchor`, whose `top` the server
  // already computed (scroll_to - scroll_lead, on the now indicator's
  // scale). It measures no layout to decide WHERE to go: it only brings the
  // anchor to the top of whichever ancestor scrolls the grid (the view
  // container, or the week body when that one is bounded). Runs once per
  // anchor; the anchor's id carries the visible dates, so a view switch or
  // navigation mounts a new one, and a plain re-render never fights the
  // viewer's own scrolling. A calendar mounted hidden (display: none, e.g. a
  // collapsed panel) scrolls the first time it gets a size.
  window.PhoenixLiveCalendarHooks.ScrollToTime = {
    mounted() {
      this._root = this.el.closest(".cal-container") || this.el.parentElement;
      if (this._scroll()) return;

      if (typeof ResizeObserver === "undefined") return;
      this._observer = new ResizeObserver(() => {
        if (this._scroll()) this._stop();
      });
      this._observer.observe(this._root);
    },

    destroyed() {
      this._stop();
    },

    _stop() {
      if (this._observer) this._observer.disconnect();
      this._observer = null;
    },

    // true once there was a scroll box to settle (or nothing needed it)
    _scroll() {
      if (this.el.offsetParent === null) return false; // hidden: wait
      var box = this._scrollBox();
      if (!box) return true; // the whole grid fits: nothing to do
      var delta =
        this.el.getBoundingClientRect().top - box.getBoundingClientRect().top;
      box.scrollTop += delta;
      return true;
    },

    _scrollBox() {
      var node = this.el.parentElement;
      while (node) {
        var overflow = window.getComputedStyle(node).overflowY;
        if (
          (overflow === "auto" || overflow === "scroll") &&
          node.scrollHeight > node.clientHeight
        ) {
          return node;
        }
        if (node === this._root) return null;
        node = node.parentElement;
      }
      return null;
    },
  };

  // ============================================================
  // PhoenixLiveCalendarContainer — composite hook for the main container
  // ============================================================
  window.PhoenixLiveCalendarHooks.PhoenixLiveCalendarContainer = {
    mounted() {
      // Initialize sub-hooks on the same element
      var hooks = [
        "TimeRangeSelect",
        "EventDrag",
        "EventResize",
        "ResponsiveContainer",
        "TouchHandler",
      ];
      this._subHooks = [];

      hooks.forEach((name) => {
        var hook = Object.create(window.PhoenixLiveCalendarHooks[name]);
        hook.el = this.el;
        hook.pushEvent = this.pushEvent.bind(this);
        hook.pushEventTo = this.pushEventTo.bind(this);
        hook.handleEvent = this.handleEvent.bind(this);
        hook.liveSocket = this.liveSocket;

        if (hook.mounted) hook.mounted();
        this._subHooks.push(hook);
      });
    },

    updated() {
      this._subHooks.forEach((hook) => {
        if (hook.updated) hook.updated();
      });
    },

    destroyed() {
      this._subHooks.forEach((hook) => {
        if (hook.destroyed) hook.destroyed();
      });
    },
  };
})();
