/**
 * Shared pointer-gesture controller for the floating module windows.
 *
 * Remote, Radio and Browser are three different window *models* (two uniform
 * scale boxes and one free W×H surface) with one gesture contract:
 *
 *   pointerdown → snapshot (painted box, intent, painted scale)
 *               → pointermove math (clamp) → paint
 *               → pointerup → commit intent
 *
 * Two invariants the modules used to get wrong, and which live here now:
 *
 *  1. **A drag only moves.** Nothing in the drag path may write a size, so a
 *     drag can never change how big the window is.
 *  2. **A resize works from intent.** The painted box may be smaller than the
 *     intent (the host viewport fitted it). Resizing therefore scales the
 *     *intent* by the ratio the pointer asked for, instead of writing the
 *     (possibly capped) painted size back — writing it back is what ratcheted
 *     the window permanently smaller every time the viewport shrank.
 *
 * The module supplies its model + paint/commit callbacks; this file owns the
 * pointer plumbing, the CSS state classes, and the geometry math.
 */
import { clampModuleScale, uniformScaleFromCorner, freeCornerResize } from './moduleScaleResize.js';

/**
 * @typedef {{
 *   kind: 'uniform',
 *   baseW: number, baseH: number,
 *   minScale?: number, maxScale?: number,
 *   getIntent: () => number,
 *   setIntent: (scale: number) => void,
 *   getPainted: () => number
 * }} UniformModel
 *
 * @typedef {{
 *   kind: 'free',
 *   minW: number, minH: number,
 *   getIntent: () => { width: number, height: number },
 *   setIntent: (size: { width: number, height: number }) => void
 * }} FreeModel
 */

/**
 * @param {{
 *   getModule: () => HTMLElement | null,
 *   getDialog: () => HTMLElement | null,
 *   dragHandleSelector: string,
 *   resolveModel: () => (UniformModel | FreeModel | null),
 *   getPaintedBox: () => { left: number, top: number, width: number, height: number },
 *   apply: (box: { left: number, top: number, width?: number, height?: number }) => void,
 *   commit?: () => void
 * }} opts
 */
export function createFloatGestures({
    getModule,
    getDialog,
    dragHandleSelector,
    resolveModel,
    getPaintedBox,
    apply,
    commit
}) {
    /**
     * @type {null | {
     *   mode: 'drag'|'resize',
     *   edge: string,
     *   pointerId: number,
     *   startX: number,
     *   startY: number,
     *   box: { left: number, top: number, width: number, height: number },
     *   intent: number | { width: number, height: number },
     *   painted: number,
     *   model: UniformModel | FreeModel
     * }}
     */
    let gesture = null;

    function setBusy(on) {
        const module = getModule();
        if (on) {
            module?.classList.add('is-resizing');
            return;
        }
        module?.classList.remove('is-resizing');
        module?.querySelectorAll(dragHandleSelector).forEach((node) => node.classList.remove('is-dragging'));
        getDialog()?.classList.remove('is-dragging');
    }

    function onMove(e) {
        if (!gesture || e.pointerId !== gesture.pointerId) return;
        const g = gesture;
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;

        if (g.mode === 'drag') {
            // Position only — the size is never touched by a drag.
            apply({ left: g.box.left + dx, top: g.box.top + dy });
            return;
        }

        if (g.model.kind === 'uniform') {
            const next = uniformScaleFromCorner({
                originLeft: g.box.left,
                originTop: g.box.top,
                originW: g.box.width,
                originH: g.box.height,
                // Corner math runs on the *painted* box so the frame tracks the
                // pointer exactly; the result is then expressed as a ratio.
                originScale: g.painted > 0 ? g.painted : 1,
                baseW: g.model.baseW,
                baseH: g.model.baseH,
                dx,
                dy,
                edge: g.edge,
                minScale: g.model.minScale,
                maxScale: g.model.maxScale
            });
            const painted = g.painted > 0 ? g.painted : 1;
            const intent = typeof g.intent === 'number' ? g.intent : 1;
            g.model.setIntent(
                clampModuleScale(intent * (next.scale / painted), {
                    min: g.model.minScale,
                    max: g.model.maxScale
                })
            );
            apply({ left: next.left, top: next.top });
            return;
        }

        // Free surface: resize the intent itself, so a window the host fitted
        // small keeps its real size and grows back with the viewport.
        const intent = g.model.getIntent();
        const next = freeCornerResize({
            originLeft: g.box.left,
            originTop: g.box.top,
            originW: intent.width,
            originH: intent.height,
            dx,
            dy,
            edge: g.edge,
            minW: g.model.minW,
            minH: g.model.minH
        });
        g.model.setIntent({ width: next.width, height: next.height });
        apply(next);
    }

    function onEnd(e) {
        if (!gesture || e.pointerId !== gesture.pointerId) return;
        try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        gesture = null;
        setBusy(false);
        commit?.();
    }

    /**
     * Start a drag (`mode === 'drag'`) or a corner resize.
     * @returns {boolean} true when the gesture took over the pointer
     */
    function begin(e, mode, edge = '') {
        if (gesture) return false;
        if (e.button != null && e.button !== 0) return false;
        const dialog = getDialog();
        const model = resolveModel();
        if (!dialog || !model) return false;
        gesture = {
            mode,
            edge: edge || 'se',
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            box: { ...getPaintedBox() },
            intent: model.kind === 'uniform' ? model.getIntent() : { ...model.getIntent() },
            painted: model.kind === 'uniform' ? model.getPainted() : 0,
            model
        };
        if (mode === 'drag') {
            dialog.classList.add('is-dragging');
            getModule()?.querySelectorAll(dragHandleSelector)
                .forEach((node) => node.classList.add('is-dragging'));
        } else {
            getModule()?.classList.add('is-resizing');
        }
        try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
        e.preventDefault?.();
        return true;
    }

    return {
        begin,
        isActive: () => gesture != null,
        /** Abort without committing (module closed / torn down mid-gesture). */
        cancel() {
            if (!gesture) return;
            gesture = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onEnd);
            window.removeEventListener('pointercancel', onEnd);
            setBusy(false);
        }
    };
}
